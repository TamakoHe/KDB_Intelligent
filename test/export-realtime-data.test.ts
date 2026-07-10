import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  exportBatteryRealtimeData,
  GEN2_BATTERY_BASE_FIELD_LABELS,
  GEN3_BATTERY_BASE_FIELD_LABELS,
  queryBatteryCommandReadiness,
  queryBatteryStatusById,
  resolveTimeRange,
  type KdbApiClients,
} from "../src/index.js"

function createFakeClients(onRequest: (generation: "gen2" | "gen3", request: any) => void): KdbApiClients {
  const makeClient = (generation: "gen2" | "gen3") =>
    ({
      requestArrayBuffer: async (request: any) => {
        onRequest(generation, request)
        return {
          data: new TextEncoder().encode("fake-xlsx").buffer,
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
  assert.equal(await fs.readFile(outputPath, "utf8"), "fake-xlsx")
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
  assert.equal(await fs.readFile(outputPath, "utf8"), "fake-xlsx")
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
