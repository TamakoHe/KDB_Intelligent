import OpenAI from "openai"
import type { AppSettings, ChatReply, ResultCard } from "../shared.js"
import { HistoryStore } from "./history.js"
import { executeTool, modelTools } from "./tools.js"
import { loadKdbSkill } from "./skill-loader.js"

const SYSTEM_PROMPT = `你是 KDB 电池运维助手。下方 KDB CLI SKILL 是标准操作规范。普通查询、标准导出、控制、参数和 OTA 请求优先转化为一次 run_kdb_cli_plan 调用：argv 仅包含 kdb 后的参数，复杂任务可包含多个步骤。不要输出 npm、node、Shell 或 OpenClaw 命令；绝不编造执行结果。批量操作使用重复 --battery-id，不能使用 --battery-file。导出时不要传 --output 或 --output-dir，桌面端会自动保存到 Documents/KDB Copilot Exports；历史数据导出默认使用 --source auto，除非用户明确要求仅网页 API 或仅本地库。查询与导出可直接计划执行；写操作只能形成 CLI 预览，不能包含 --confirm。工具报错后不要重复相同步骤。local 来源是历史快照，不能描述为当前在线状态。

当请求需要动态筛选所有电池、跨电池聚合、按历史故障条件发现目标或 CLI 无法表达的只读分析时，调用 run_kdb_analysis，不要退回生成 SQL/Node/Shell。分析脚本必须定义 async function main(kdb)，只能调用 kdb.read.batteries、kdb.read.history 和 kdb.export.realtime；只能读取和导出，不能控制设备、写参数、OTA、访问文件、网络、进程或配置。先生成预览，桌面端会展示脚本和权限并等待用户点击“运行分析”；绝不要求用户回复“确认”，也不要输出任何确认令牌。默认 source 为 auto，API 成功但为空才回退本地；API 错误不回退。分析结果中的本地数据必须标记为历史快照。

桌面确认协议（不可违反）：控制命令、模式设置、参数写入、批量写入、固件状态变更、OTA 启动或回滚，必须先调用 run_kdb_cli_plan 生成 CLI 预览。预览返回的 confirmationToken 由桌面端保管，并由确认卡片上的“确认执行”按钮使用。绝不输出、复述或要求用户输入令牌；绝不要求用户回复“确认”、"确认无误后回复确认"或类似文字来执行操作。若缺少执行所需的信息，只提出具体缺失项；若信息齐全，必须调用工具，而不是以普通文本结束。`

const MANUAL_CONFIRMATION_PATTERN = /(?:回复|输入|发送|键入|提供).{0,12}(?:确认|令牌)|(?:确认无误|确认后).{0,24}(?:回复|即可|开始|执行|升级)|(?:confirmationToken|确认令牌)/i

export class KdbAgent {
  constructor(private readonly history: HistoryStore) {}

  async reply(text: string, settings: AppSettings): Promise<ChatReply> {
    if (!settings.deepseek.apiKey) throw new Error("请先在设置中填写 DeepSeek API Key")
    this.history.append("user", text)
    const client = new OpenAI({ apiKey: settings.deepseek.apiKey, baseURL: settings.deepseek.baseUrl, dangerouslyAllowBrowser: false })
    const skill = await loadKdbSkill()
    const messages: any[] = [
      { role: "system", content: `${SYSTEM_PROMPT}\n\n${runtimeClockContext()}\n\n--- KDB CLI SKILL.md ---\n${skill}` },
      ...this.history.list().slice(-30).map((item) => ({ role: item.role, content: item.content })),
    ]
    const cards: ResultCard[] = []
    let forcePreviewTool = false

    for (let turn = 0; turn < 8; turn++) {
      const response = await client.chat.completions.create({
        model: settings.deepseek.model,
        messages,
        tools: modelTools as any,
        tool_choice: forcePreviewTool ? { type: "function", function: { name: "run_kdb_cli_plan" } } : "auto",
        temperature: 0.2,
      })
      const message: any = response.choices[0]?.message
      if (!message) throw new Error("模型未返回有效响应")
      messages.push(message)
      if (!message.tool_calls?.length) {
        const answer = message.content?.trim() || "已完成处理。"
        if (!cards.some((card) => card.actionId) && MANUAL_CONFIRMATION_PATTERN.test(answer) && !forcePreviewTool) {
          forcePreviewTool = true
          messages.push({
            role: "user",
            content: "系统纠正：不得要求用户回复“确认”或输入令牌。请立即调用 run_kdb_cli_plan 为该写操作创建无副作用的 CLI 预览；不要携带 --confirm。桌面端会显示确认按钮。",
          })
          continue
        }
        this.history.append("assistant", answer, cards)
        return { text: answer, cards }
      }
      for (const call of message.tool_calls) {
        let rawArgs: unknown
        try { rawArgs = JSON.parse(call.function.arguments) } catch { rawArgs = {} }
        const result = await executeTool(call.function.name, rawArgs, settings)
        cards.push(...result.cards)
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result.model) })
      }
    }
    throw new Error("模型工具调用超过最大轮次，请缩小问题范围后重试")
  }
}

function runtimeClockContext(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  const localTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "系统本地时区"
  return `桌面端当前系统时间：${localTime}（${timezone}）。处理“最近 N 天/小时”等相对时间时，必须使用 --hours（例如最近 7 天为 --hours 168），不要根据模型知识日期编造固定起止日期；CLI 会以此运行时钟计算结束时间。`
}
