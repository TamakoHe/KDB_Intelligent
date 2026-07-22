import assert from "node:assert/strict"
import test from "node:test"
import { listAnalysisBatteries, listAnalysisHistory } from "../src/application/analysis/analysis-data.js"
import { LocalHistoryRepository } from "../src/domain/local/local-history-repository.js"

function config() {
  return {
    routing: { gen2_prefixes: ["5", "8", "9"], gen3_prefixes: ["4", "6"] },
  } as any
}

function apiClient(rows: unknown[], total = rows.length) {
  return {
    request: async () => ({ status: 200, headers: new Headers(), data: { code: 200, total, rows } }),
  } as any
}

test("高级分析 API 基础表筛选只返回白名单字段匹配的数据", async () => {
  const result = await listAnalysisBatteries({
    clients: { config: config(), gen2: apiClient([]), gen3: apiClient([{ batteryId: "623B1C10", faultStatus: 108 }]) } as any,
    generation: "gen3",
    source: "api",
    filters: [{ field: "faultStatus", operator: "eq", value: 108 }],
    limit: 2,
  })
  assert.equal(result.source, "api")
  assert.equal(result.rows[0]?.batteryId, "623B1C10")
})

test("高级分析 API 成功空结果时才回退本地仓储", async () => {
  const localRepository = {
    listBatteryBase: async () => [{ batteryId: "623B1C10", faultStatus: 108 }],
    listRealtime: async () => [],
  }
  const result = await listAnalysisBatteries({
    clients: { config: config(), gen2: apiClient([]), gen3: apiClient([]) } as any,
    generation: "gen3",
    source: "auto",
    filters: [{ field: "faultStatus", operator: "eq", value: 108 }],
    limit: 2,
    localRepository: localRepository as any,
  })
  assert.equal(result.source, "local")
  assert.equal(result.fallbackFrom, "api-empty")
  assert.equal(result.rows[0]?.batteryId, "623B1C10")
})

test("高级分析历史读取要求单电池并使用时间参数", async () => {
  const calls: Array<{ query?: Record<string, unknown> }> = []
  const client = {
    request: async (request: { query?: Record<string, unknown> }) => {
      calls.push(request)
      return { status: 200, headers: new Headers(), data: { code: 200, total: 1, rows: [{ batteryId: "623B1C10", logTime: "2026-05-15 14:00:00", faultStatus: 108 }] } }
    },
  }
  const result = await listAnalysisHistory({
    clients: { config: config(), gen2: client, gen3: client } as any,
    generation: "gen3",
    batteryId: "623B1C10",
    source: "api",
    start: "2026-05-15 00:00:00",
    end: "2026-05-16 00:00:00",
    filters: [{ field: "faultStatus", operator: "eq", value: 108 }],
    limit: 20,
  })
  assert.equal(result.rows.length, 1)
  assert.equal((calls[0]?.query as any)?.params.beginLogTime, "2026-05-15 00:00:00")
})

test("本地高级分析筛选使用参数化 SQL 和 LIMIT", async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const repository = new LocalHistoryRepository({
    query: async (sql, values = []) => {
      calls.push({ sql, values })
      return [[{ battery_id: "623B1C10", fault_status: 108 }], []]
    },
  })
  const rows = await repository.listBatteryBase({
    generation: "gen3",
    filters: [{ field: "faultStatus", operator: "eq", value: 108 }],
    limit: 2000,
  })
  assert.equal(rows[0]?.batteryId, "623B1C10")
  assert.match(calls[0]!.sql, /`fault_status` = \?/) 
  assert.match(calls[0]!.sql, /LIMIT \?/)
  assert.deepEqual(calls[0]!.values, [108, 2000])
})
