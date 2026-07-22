import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import ExcelJS from "exceljs"
import {
  exportBatteryRealtimeData,
  exportExcel,
  normalizeExportMaxRows,
  GEN2_BATTERY_BASE_FIELD_LABELS,
  GEN3_BATTERY_BASE_FIELD_LABELS,
  queryBatteryCommandReadiness,
  queryBatteryStatusById,
  resolveTimeRange,
  type KdbApiClients,
} from "../src/index.js"

function createFakeClients(onRequest: (generation: "gen2" | "gen3", request: any) => unknown): KdbApiClients {
  const workbookCache = new Map<number, ArrayBuffer>()
  const makeClient = (generation: "gen2" | "gen3") =>
    ({
      requestArrayBuffer: async (request: any) => {
        const requestedRows = onRequest(generation, request)
        const rowCount = typeof requestedRows === "number" ? requestedRows : 1
        let data = workbookCache.get(rowCount)
        if (!data) {
          const workbook = new ExcelJS.Workbook()
          const sheet = workbook.addWorksheet("电池详情数据")
          sheet.addRow(["数据时间", "电池编码"])
          for (let index = 0; index < rowCount; index++) sheet.addRow([`2026-07-01 00:00:${String(index % 60).padStart(2, "0")}`, `ROW-${index}`])
          data = await workbook.xlsx.writeBuffer()
          workbookCache.set(rowCount, data)
        }
        return {
          data,
          status: 200,
          headers: new Headers(),
        }
      },
    }) as any
  const gen2 = makeClient("gen2")
  const gen3 = makeClient("gen3")
  return {
    config: {
      app: { default_output_dor: "./out" },
      routing: { gen2_prefixes: ["5", "8", "9"], gen3_prefixes: ["4", "6"] },
    } as any,
    gen2,
    gen3,
    getClient: (generation) => (generation === "gen2" ? gen2 : gen3),
  }
}

function createReadinessClients(args: {
  baseRows: Array<Record<string, unknown>>
  registrationRows: Array<Record<string, unknown>>
}): KdbApiClients {
  const makeClient = () =>
    ({
      request: async (request: { path: string }) => ({
        data: {
          code: 200,
          total: request.path.includes("DeviceRegisterData") ? args.registrationRows.length : args.baseRows.length,
          rows: request.path.includes("DeviceRegisterData") ? args.registrationRows : args.baseRows,
        },
        status: 200,
        headers: new Headers(),
      }),
    }) as any
  const gen2 = makeClient()
  const gen3 = makeClient()
  return {
    config: {
      routing: { gen2_prefixes: ["5", "8", "9"], gen3_prefixes: ["4", "6"] },
    } as any,
    gen2,
    gen3,
    getClient: (generation) => (generation === "gen2" ? gen2 : gen3),
  }
}

test("Gen2 实时导出映射到 realtimeMsgLog 和 createTime", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kdb-sdk-test-"))
  const outputPath = path.join(dir, "gen2.xlsx")
  let captured: any
  const result = await exportBatteryRealtimeData({
    clients: createFakeClients((_generation, request) => (captured = request)),
    batteryId: "8F9AE708",
    start: "2026-07-01 00:00:00",
    end: "2026-07-02 00:00:00",
    outputPath,
  })

  assert.equal(result.generation, "gen2")
  assert.equal(result.exportType, "realtimeMsgLog")
  assert.equal(captured.path, "/hckd/hckdLiheMsgLog/export")
  assert.deepEqual(captured.query.params, {
    beginCreateTime: "2026-07-01 00:00:00",
    endCreateTime: "2026-07-02 00:00:00",
  })
  assert.equal(captured.query.pageSize, 8_000)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(outputPath)
  assert.equal(workbook.worksheets[0]?.rowCount, 2)
  await fs.rm(dir, { recursive: true, force: true })
})

test("Gen3 实时导出映射到 cycle01MsgLog 和 logTime", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kdb-sdk-test-"))
  const outputPath = path.join(dir, "gen3.xlsx")
  let captured: any
  const result = await exportBatteryRealtimeData({
    clients: createFakeClients((_generation, request) => (captured = request)),
    batteryId: "62413828",
    start: "2026-07-01 00:00:00",
    end: "2026-07-02 00:00:00",
    outputPath,
  })

  assert.equal(result.generation, "gen3")
  assert.equal(result.exportType, "cycle01MsgLog")
  assert.equal(captured.path, "/managekdb/kdbCycle01MsgLog/export")
  assert.deepEqual(captured.query.params, {
    beginLogTime: "2026-07-01 00:00:00",
    endLogTime: "2026-07-02 00:00:00",
  })
  assert.equal(captured.query.pageSize, 8_000)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(outputPath)
  assert.equal(workbook.worksheets[0]?.rowCount, 2)
  await fs.rm(dir, { recursive: true, force: true })
})

test("导出条目上限默认 20000，且可覆盖并校验范围", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kdb-sdk-test-"))
  const outputPath = path.join(dir, "custom-limit.xlsx")
  let captured: any
  await exportBatteryRealtimeData({
    clients: createFakeClients((_generation, request) => (captured = request)),
    batteryId: "62413828",
    hours: 1,
    outputPath,
    maxRows: 24_000,
  })
  assert.equal(captured.query.pageSize, 8_000)
  assert.equal(normalizeExportMaxRows(undefined), 20_000)
  assert.throws(() => normalizeExportMaxRows(0), /导出最大条目/)
  assert.throws(() => normalizeExportMaxRows(100_001), /导出最大条目/)
  await fs.rm(dir, { recursive: true, force: true })
})

test("API 单次达到 8000 条时按时间二分并合并表头一次", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kdb-sdk-test-"))
  const outputPath = path.join(dir, "chunked.xlsx")
  const requests: any[] = []
  const result = await exportExcel({
    clients: createFakeClients((_generation, request) => {
      requests.push(request)
      const params = request.query.params as Record<string, string>
      const start = Date.parse(params.beginLogTime.replace(" ", "T"))
      const end = Date.parse(params.endLogTime.replace(" ", "T"))
      return end - start > 2 * 24 * 60 * 60 * 1000 ? 8_000 : 100
    }),
    generation: "gen3",
    type: "cycle01MsgLog",
    query: { batteryId: "62413828", params: { beginLogTime: "2026-07-01 00:00:00", endLogTime: "2026-07-08 00:00:00" } },
    outputPath,
    maxRows: 20_000,
  })
  assert.ok(requests.length > 1)
  assert.ok(requests.every((request) => request.query.pageSize <= 8_000))
  assert.equal(result.rowCount, 400)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(outputPath)
  assert.equal(workbook.worksheets[0]?.rowCount, 401)
  await fs.rm(dir, { recursive: true, force: true })
})

test("总上限小于 API 单次上限时截断合并结果", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kdb-sdk-test-"))
  const outputPath = path.join(dir, "capped.xlsx")
  let calls = 0
  const result = await exportExcel({
    clients: createFakeClients(() => { calls++; return 8_000 }),
    generation: "gen3",
    type: "cycle01MsgLog",
    query: { batteryId: "62413828", params: { beginLogTime: "2026-07-01 00:00:00", endLogTime: "2026-07-01 01:00:00" } },
    outputPath,
    maxRows: 150,
  })
  assert.equal(calls, 1)
  assert.equal(result.rowCount, 150)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(outputPath)
  assert.equal(workbook.worksheets[0]?.rowCount, 151)
  await fs.rm(dir, { recursive: true, force: true })
})

test("拒绝不存在的日期和反向时间范围", () => {
  assert.throws(
    () => resolveTimeRange({ start: "2026-02-30 00:00:00", end: "2026-03-01 00:00:00" }),
    /不是有效时间/,
  )
  assert.throws(
    () => resolveTimeRange({ start: "2026-07-02 00:00:00", end: "2026-07-01 00:00:00" }),
    /开始时间必须早于结束时间/,
  )
})

test("Gen2 在线电池判定为可以直接下发", async () => {
  const result = await queryBatteryCommandReadiness({
    clients: createReadinessClients({
      baseRows: [{ batteryId: "8F9AE708", lte4gStatus: "1", lte4gTime: "2026-07-10 12:00:00" }],
      registrationRows: [{ batteryId: "8F9AE708", registerStatus: 1 }],
    }),
    batteryId: "8f9ae708",
  })

  assert.equal(result.canSendCommand, true)
  assert.equal(result.state, "READY")
  assert.equal(result.networkStatus, "ONLINE")
  assert.equal(result.registration, "REGISTERED")
})

test("Gen3 离线且未注册电池判定为不可直接下发", async () => {
  const result = await queryBatteryCommandReadiness({
    clients: createReadinessClients({
      baseRows: [{ batteryId: "62413828", lte4gStatus: 2 }],
      registrationRows: [],
    }),
    batteryId: "62413828",
  })

  assert.equal(result.canSendCommand, false)
  assert.equal(result.state, "OFFLINE")
  assert.equal(result.networkStatus, "OFFLINE")
  assert.equal(result.registration, "UNREGISTERED")
})

test("基础表中不存在的电池判定为不可下发", async () => {
  const result = await queryBatteryCommandReadiness({
    clients: createReadinessClients({ baseRows: [], registrationRows: [] }),
    batteryId: "62413828",
  })
  assert.equal(result.canSendCommand, false)
  assert.equal(result.state, "NOT_FOUND")
})

test("Gen2 状态详情覆盖网站 Excel 的全部 48 列", async () => {
  const fullRow = Object.fromEntries(
    Object.keys(GEN2_BATTERY_BASE_FIELD_LABELS).map((key) => [key, null]),
  )
  Object.assign(fullRow, {
    batteryId: "959F1FDC",
    lte4gStatus: "1",
    lte4gTime: "2026-07-10 11:13:21",
    bluetoothStatus: "2",
    batteryStatus: "0",
  })

  const result = await queryBatteryStatusById({
    clients: createReadinessClients({ baseRows: [fullRow], registrationRows: [] }),
    batteryId: "959f1fdc",
  })

  assert.equal(Object.keys(GEN2_BATTERY_BASE_FIELD_LABELS).length, 48)
  assert.equal(result.found, true)
  assert.deepEqual(result.details, fullRow)
  assert.equal(result.summary?.batteryId, "959F1FDC")
  assert.ok(!Object.hasOwn(result.summary ?? {}, "raw"))
})

test("Gen3 状态详情覆盖网站 Excel 的全部 55 列并保留数值状态", async () => {
  const fullRow = Object.fromEntries(
    Object.keys(GEN3_BATTERY_BASE_FIELD_LABELS).map((key) => [key, null]),
  )
  Object.assign(fullRow, {
    batteryId: "40457BDE",
    batteryDataId: "DE7B4540",
    lte4gStatus: "1",
    lte4gTime: "2026-07-10 11:22:20",
    bluetoothStatus: "2",
    batteryStatus: 2,
    faultStatus: 2,
    chargeDischargeStatus: 2,
  })

  const result = await queryBatteryStatusById({
    clients: createReadinessClients({ baseRows: [fullRow], registrationRows: [] }),
    batteryId: "40457bde",
  })

  assert.equal(Object.keys(GEN3_BATTERY_BASE_FIELD_LABELS).length, 55)
  assert.equal(result.found, true)
  assert.deepEqual(result.details, fullRow)
  assert.equal(result.detailFieldLabels.batteryDataId, "电池简编码")
  assert.equal(result.summary?.batteryStatus, "2")
  assert.equal(result.summary?.faultStatus, "2")
  assert.equal(result.summary?.chargeDischargeStatus, "2")

  const partialResult = await queryBatteryStatusById({
    clients: createReadinessClients({ baseRows: [{ batteryId: "40457BDE" }], registrationRows: [] }),
    batteryId: "40457BDE",
  })
  assert.equal(Object.keys(partialResult.details ?? {}).length, 55)
  assert.equal(partialResult.details?.hardwareVersion, null)
})

test("Gen3 status 从 Cycle01 实时上报补充应急模式", async () => {
  const result = await queryBatteryStatusById({
    clients: createReadinessClients({
      baseRows: [{ batteryId: "40457BDE", lte4gStatus: "1", workingModeStatus: 3 }],
      registrationRows: [],
    }),
    batteryId: "40457BDE",
  })
  assert.equal(result.summary?.workingModeStatus, "3")
  assert.equal(result.summary?.workingModeText, "应急模式")
  assert.equal(result.latestRealtime?.workingModeStatus, 3)
})
