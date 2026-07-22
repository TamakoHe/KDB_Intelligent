import OpenAI from "openai"
import type { AppSettings, ChatReply, ResultCard } from "../shared.js"
import { HistoryStore } from "./history.js"
import { executeTool, modelTools } from "./tools.js"

const SYSTEM_PROMPT = `你是 KDB 电池运维助手。只能依据工具结果回答，不得编造电池状态、时间、文件路径或操作结果。优先调用工具处理电池查询、导出、参数和固件问题。用户给出两个或更多电池编号并要求导出实时数据时，必须只调用一次 export_realtime_batch，绝不能逐块重复调用 export_realtime。工具报错后不要自动重试同一个导出。控制、参数写入与 OTA 必须先调用 preview 工具；绝不能声称已经执行，除非用户在桌面确认卡片中明确确认。local 来源始终是历史快照，不能描述为当前在线状态。`

export class KdbAgent {
  constructor(private readonly history: HistoryStore) {}

  async reply(text: string, settings: AppSettings): Promise<ChatReply> {
    if (!settings.deepseek.apiKey) throw new Error("请先在设置中填写 DeepSeek API Key")
    this.history.append("user", text)
    const client = new OpenAI({ apiKey: settings.deepseek.apiKey, baseURL: settings.deepseek.baseUrl, dangerouslyAllowBrowser: false })
    const messages: any[] = [
      { role: "system", content: SYSTEM_PROMPT },
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
        this.history.append("assistant", answer)
        return { text: answer, cards }
      }
      for (const call of message.tool_calls) {
        let rawArgs: unknown
        try { rawArgs = JSON.parse(call.function.arguments) } catch { rawArgs = {} }
        const result = await executeTool(call.function.name, rawArgs, settings)
        if (result.card) cards.push(result.card)
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result.model) })
      }
    }
    throw new Error("模型工具调用超过最大轮次，请缩小问题范围后重试")
  }
}
