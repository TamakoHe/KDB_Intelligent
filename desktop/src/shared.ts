export type DataSource = "api" | "local" | "auto"
export type ThemeMode = "dark" | "light" | "system"

export type ResultCard = {
  id: string
  kind: "status" | "export" | "preview" | "success" | "error" | "data"
  title: string
  summary: string
  data?: Record<string, unknown>
  actionId?: string
  actionLabel?: string
  /** A preview loaded from prior history; its short-lived confirmation token is no longer usable. */
  actionExpired?: boolean
}

export type ChatReply = {
  text: string
  cards: ResultCard[]
}

export type AppSettings = {
  theme: ThemeMode
  /** Per-export cap applied by the desktop agent to both API and local exports. */
  exportMaxRows: number
  deepseek: {
    apiKey: string
    baseUrl: string
    model: string
  }
  /** Managed by the desktop application; never points at an external project directory. */
  kdbConfigRoot: string
}

export type KdbConfigFiles = {
  publicToml: string
  localToml: string
  configRoot: string
}

export type LocalDatabaseConnectionTest = {
  configured: boolean
  ok: boolean
  host?: string
  port?: number
  database?: string
  message: string
  errorCode?: string
  workaround?: {
    title: string
    description: string
    command: string
  }
}

export type ChatHistoryItem = {
  id: number
  role: "user" | "assistant"
  content: string
  createdAt: string
  /** Result cards belonging to this message. Historical cards never retain confirmation tokens. */
  cards?: ResultCard[]
}

export type KdbDesktopApi = {
  settings: { get(): Promise<AppSettings>; save(value: AppSettings): Promise<AppSettings> }
  config: {
    get(): Promise<KdbConfigFiles>
    save(value: Pick<KdbConfigFiles, "publicToml" | "localToml">): Promise<KdbConfigFiles>
    testLocalDatabase(localToml: string): Promise<LocalDatabaseConnectionTest>
  }
  history: { list(): Promise<ChatHistoryItem[]>; clear(): Promise<void> }
  chat: { send(text: string): Promise<ChatReply> }
  action: { confirm(actionId: string): Promise<ResultCard>; cancel(actionId: string): Promise<void> }
  file: { reveal(path: string): Promise<void>; open(path: string): Promise<void> }
  clipboard: { writeText(value: string): Promise<void> }
}
