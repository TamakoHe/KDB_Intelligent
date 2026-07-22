/** Selects the read path. Mutating operations are deliberately API-only. */
export type DataSource = "api" | "local" | "auto"

export type QueryOrigin = {
  source: "api" | "local"
  /** Present when auto succeeded only after an API response with no rows. */
  fallbackFrom?: "api-empty"
  /** Local history is a snapshot and must never be presented as live state. */
  isHistorical?: true
  /** Timestamp of the newest local record used for the response. */
  asOf?: string | null
}

export function parseDataSource(value: string | undefined): DataSource | undefined {
  if (value === undefined) return undefined
  if (value === "api" || value === "local" || value === "auto") return value
  throw new Error("--source 只支持 api、local 或 auto")
}

export function assertApiOnlySource(source: DataSource | undefined, operation: string): void {
  if (source && source !== "api") {
    throw new Error(`${operation} 依赖实时后台状态，仅支持 --source api`)
  }
}
