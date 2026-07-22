import OpenAI from "openai"
import type { AppSettings, ChatReply, ResultCard } from "../shared.js"
import { HistoryStore } from "./history.js"
import { executeTool, modelTools } from "./tools.js"
import { loadKdbSkill } from "./skill-loader.js"

const SYSTEM_PROMPT = `你是 KDB 电池运维助手。下方 KDB CLI SKILL 是唯一操作规范。将用户请求转化为一次 run_kdb_cli_plan 调用：argv 仅包含 kdb 后的参数，复杂任务可包含多个步骤。不要输出 npm、node、Shell 或 OpenClaw 命令；绝不编造执行结果。批量操作使用重复 --battery-id，不能使用 --battery-file。导出时不要传 --output 或 --output-dir，桌面端会自动保存到 Documents/KDB Copilot Exports；历史数据导出默认使用 --source auto，除非用户明确要求仅网页 API 或仅本地库。查询与导出可直接计划执行；写操作只能形成 CLI 预览，不能包含 --confirm。工具报错后不要重复相同步骤。local 来源是历史快照，不能描述为当前在线状态。`

export class KdbAgent {
  constructor(private readonly history: HistoryStore) {}

  async reply(text: string, settings: AppSettings): Promise<ChatReply> {
    if (!settings.deepseek.apiKey) throw new Error("请先在设置中填写 DeepSeek API Key")
    this.history.append("user", text)
    const client = new OpenAI({ apiKey: settings.deepseek.apiKey, baseURL: settings.deepseek.baseUrl, dangerouslyAllowBrowser: false })
    const skill = await loadKdbSkill()
    const messages: any[] = [
      { role: "system", content: `${SYSTEM_PROMPT}\n\n--- KDB CLI SKILL.md ---\n${skill}` },
      ...this.history.list().slice(-30).map((item) => ({ role: item.role, content: item.content })),
    ]
    const cards: ResultCard[] = []

    for (let turn = 0; turn < 8; turn++) {
      const response = await client.chat.completions.create({ model: settings.deepseek.model, messages, tools: modelTools as any, tool_choice: "auto", temperature: 0.2 })
      const message: any = response.choices[0]?.message
      if (!message) throw new Error("模型未返回有效响应")
      messages.push(message)
      if (!message.tool_calls?.length) {
        const answer = message.content?.trim() || "已完成处理。"
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
