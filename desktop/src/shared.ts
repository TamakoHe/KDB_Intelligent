export type DataSource = "api" | "local" | "auto"

export type ResultCard = {
  id: string
  kind: "status" | "export" | "preview" | "success" | "error" | "data"
  title: string
  summary: string
  data?: Record<string, unknown>
  actionId?: string
  actionLabel?: string
}

export type ChatReply = {
  text: string
  cards: ResultCard[]
}

export type AppSettings = {
  deepseek: {
    apiKey: string
    baseUrl: string
    model: string
  }
  /** Directory containing config/kdb.toml and config/kdb.local.toml. */
  kdbConfigRoot: string
}

export type ChatHistoryItem = {
  id: number
  role: "user" | "assistant"
  content: string
  createdAt: string
}

export type KdbDesktopApi = {
  settings: { get(): Promise<AppSettings>; save(value: AppSettings): Promise<AppSettings> }
  history: { list(): Promise<ChatHistoryItem[]>; clear(): Promise<void> }
  chat: { send(text: string): Promise<ChatReply> }
  action: { confirm(actionId: string): Promise<ResultCard>; cancel(actionId: string): Promise<void> }
  file: { reveal(path: string): Promise<void> }
}
