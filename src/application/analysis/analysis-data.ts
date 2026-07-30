import type { KdbApiClients } from "../../index.js"
import { assertTableOk } from "../../core/api/table-data.js"
import type { DataSource } from "../../core/data-source.js"
import type { QueryObject } from "../../core/http/http-client.js"
import { listGen2BatteryBase } from "../../domain/gen2/status/hckd-battery-base-api.js"
import { listGen2RealtimeMsgLog } from "../../domain/gen2/logs/hckd-realtime-msg-log-api.js"
import { listGen3BatteryBase } from "../../domain/gen3/status/kdb-battery-base-api.js"
import { listGen3Cycle01MsgLog } from "../../domain/gen3/logs/kdb-cycle01-msg-log-api.js"
import { createLocalHistoryRepository, type LocalFilter } from "../../domain/local/local-history-repository.js"

export type AnalysisGeneration = "gen2" | "gen3"
export type AnalysisFilterOperator = LocalFilter["operator"]
export type AnalysisFilter = LocalFilter

export type AnalysisReadResult = {
  rows: Record<string, unknown>[]
  source: "api" | "local"
  fallbackFrom?: "api-empty"
  isHistorical?: true
  warnings?: string[]
}

const API_PAGE_SIZE = 8_000
const MAX_API_PAGES = 200

export async function listAnalysisBatteries(args: {
  clients: KdbApiClients
  generation?: AnalysisGeneration
  source: DataSource
  filters?: AnalysisFilter[]
  start?: string
  end?: string
  limit: number
  localRepository?: Pick<ReturnType<typeof createLocalHistoryRepository>, "listBatteryBase" | "listRealtime">
}): Promise<AnalysisReadResult> {
  const generations = args.generation ? [args.generation] : ["gen2", "gen3"] as const
  const apiRows: Record<string, unknown>[] = []
  const apiWarnings: string[] = []
  if (args.source !== "local") {
    for (const generation of generations) {
      try {
        apiRows.push(...await listApiBatteryGeneration({ ...args, generation }))
      } catch (error) {
        // An explicitly selected generation is an all-or-nothing request. For an
        // unspecified generation, keep a successful sibling generation usable but
        // surface the failed generation instead of silently falling back to local.
        if (args.generation) throw error
        apiWarnings.push(error instanceof Error ? error.message : String(error))
      }
    }
  }
  if (args.source !== "local" && apiRows.length > 0) return {
    rows: apiRows.slice(0, args.limit),
    source: "api",
    ...(apiWarnings.length > 0 ? { warnings: apiWarnings } : {}),
  }
  if (apiWarnings.length > 0) {
    throw new Error(`高级分析 API 查询失败，未执行本地回退：${apiWarnings.join("；")}`)
  }
  if (args.source === "api") return { rows: [], source: "api" }

  const localRows: Record<string, unknown>[] = []
  for (const generation of generations) {
    const repository = args.localRepository ?? createLocalHistoryRepository(args.clients.config)
    const rows = await repository.listBatteryBase({ generation, ...(args.filters ? { filters: args.filters } : {}), ...(args.start ? { start: args.start } : {}), ...(args.end ? { end: args.end } : {}), limit: args.limit })
    localRows.push(...rows.map((row) => ({ ...row, generation })))
  }
  return { rows: localRows.slice(0, args.limit), source: "local", ...(args.source === "auto" ? { fallbackFrom: "api-empty" as const } : {}) }
}

export async function listAnalysisHistory(args: {
  clients: KdbApiClients
  batteryId: string
  generation: AnalysisGeneration
  source: DataSource
  start: string
  end: string
  filters?: AnalysisFilter[]
  fields?: string[]
  limit: number
  localRepository?: Pick<ReturnType<typeof createLocalHistoryRepository>, "listBatteryBase" | "listRealtime">
}): Promise<AnalysisReadResult> {
  if (args.source !== "local") {
    const rows = await listApiHistory({ ...args, limit: args.limit })
    if (rows.length > 0 || args.source === "api") return { rows, source: "api" }
  }
  const repository = args.localRepository ?? createLocalHistoryRepository(args.clients.config)
  const rows = await repository.listRealtime({
    generation: args.generation,
    batteryId: args.batteryId,
    start: args.start,
    end: args.end,
    maxRows: args.limit,
    ...(args.filters ? { filters: args.filters } : {}),
  })
  return { rows: rows.map((row) => ({ ...row, generation: args.generation })), source: "local", ...(args.source === "auto" ? { fallbackFrom: "api-empty" as const } : {}), isHistorical: true }
}

async function listApiBatteryGeneration(args: {
  clients: KdbApiClients
  generation: AnalysisGeneration
  filters?: AnalysisFilter[]
  start?: string
  end?: string
  limit: number
}): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  let pageNum = 1
  while (rows.length < args.limit && pageNum <= MAX_API_PAGES) {
    const pageSize = Math.min(API_PAGE_SIZE, args.limit - rows.length)
    const query = batteryQuery({ pageNum, pageSize, ...(args.filters ? { filters: args.filters } : {}), ...(args.start ? { start: args.start } : {}), ...(args.end ? { end: args.end } : {}) })
    const response = args.generation === "gen2"
      ? await listGen2BatteryBase(args.clients.gen2, query)
      : await listGen3BatteryBase(args.clients.gen3, query)
    assertTableOk({ generation: args.generation, action: "analysis.batteryBase", result: response.data })
    const page = (response.data.rows ?? []).map((row) => ({ ...(row as Record<string, unknown>), generation: args.generation }))
    rows.push(...page.filter((row) => matchesFilters(row, args.filters)))
    const total = Number(response.data.total ?? page.length)
    if (page.length === 0 || pageNum * pageSize >= total) break
    pageNum++
  }
  return rows.slice(0, args.limit)
}

async function listApiHistory(args: {
  clients: KdbApiClients
  batteryId: string
  generation: AnalysisGeneration
  start: string
  end: string
  filters?: AnalysisFilter[]
  fields?: string[]
  limit: number
}): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  let pageNum = 1
  while (rows.length < args.limit && pageNum <= MAX_API_PAGES) {
    const pageSize = Math.min(API_PAGE_SIZE, args.limit - rows.length)
    const params = args.generation === "gen2"
      ? { beginCreateTime: args.start, endCreateTime: args.end }
      : { beginLogTime: args.start, endLogTime: args.end }
    const query = { batteryId: args.batteryId, pageNum, pageSize, params }
    const response = args.generation === "gen2"
      ? await listGen2RealtimeMsgLog(args.clients.gen2, query)
      : await listGen3Cycle01MsgLog(args.clients.gen3, query)
    assertTableOk({ generation: args.generation, action: "analysis.history", result: response.data })
    const page = (response.data.rows ?? []).map((row) => ({ ...(row as Record<string, unknown>), generation: args.generation }))
    rows.push(...page.filter((row) => matchesFilters(row, args.filters)).map((row) => projectFields(row, args.fields)))
    const total = Number(response.data.total ?? page.length)
    if (page.length === 0 || pageNum * pageSize >= total) break
    pageNum++
  }
  return rows.slice(0, args.limit)
}

function batteryQuery(args: { pageNum: number; pageSize: number; filters?: AnalysisFilter[]; start?: string; end?: string }): QueryObject {
  const query: QueryObject = { pageNum: args.pageNum, pageSize: args.pageSize }
  for (const filter of args.filters ?? []) {
    if (filter.operator === "eq" && !Array.isArray(filter.value)) query[filter.field] = filter.value
  }
  if (args.start || args.end) {
    query.params = {
      ...(args.start ? { beginUpdateTime: args.start } : {}),
      ...(args.end ? { endUpdateTime: args.end } : {}),
    }
  }
  return query
}

function projectFields(row: Record<string, unknown>, fields?: string[]): Record<string, unknown> {
  if (!fields || fields.length === 0) return row
  const result: Record<string, unknown> = {}
  for (const field of ["batteryId", "generation", "logTime", ...fields]) {
    if (field in row) result[field] = row[field]
  }
  return result
}

function matchesFilters(row: Record<string, unknown>, filters?: AnalysisFilter[]): boolean {
  return (filters ?? []).every((filter) => {
    const actual = row[filter.field]
    const expected = filter.value
    if (filter.operator === "in") return Array.isArray(expected) && expected.some((value) => String(actual) === String(value))
    if (filter.operator === "contains") return typeof actual === "string" && typeof expected === "string" && actual.includes(expected)
    if (filter.operator === "eq") return String(actual) === String(expected)
    if (filter.operator === "neq") return String(actual) !== String(expected)
    const left = Number(actual)
    const right = Number(expected)
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false
    if (filter.operator === "gt") return left > right
    if (filter.operator === "gte") return left >= right
    if (filter.operator === "lt") return left < right
    return left <= right
  })
}
