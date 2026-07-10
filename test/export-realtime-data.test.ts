import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { exportBatteryRealtimeData, resolveTimeRange, type KdbApiClients } from "../src/index.js"

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
