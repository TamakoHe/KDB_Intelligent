export const DEFAULT_EXPORT_MAX_ROWS = 20_000
export const MAX_EXPORT_MAX_ROWS = 100_000

export function normalizeExportMaxRows(value: number | undefined): number {
  const maxRows = value ?? DEFAULT_EXPORT_MAX_ROWS
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > MAX_EXPORT_MAX_ROWS) {
    throw new Error(`导出最大条目必须是 1~${MAX_EXPORT_MAX_ROWS} 的整数`)
  }
  return maxRows
}
