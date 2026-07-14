import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createConfirmationToken, verifyConfirmationToken } from "../src/core/control/confirmation.js"
import { isTargetVersionLower, isTargetVersionNewer } from "../src/application/ota/inspect-ota-preconditions.js"
import { sendGen2OtaCommand } from "../src/domain/gen2/ota/hckd-firmware-api.js"
import { sendGen3OtaEnter } from "../src/domain/gen3/control/kdb-control-api.js"
import { resolveOtaFirmware } from "../src/application/ota/list-ota-firmware.js"
import { listOtaFirmwareStatusHistory, rollbackOtaFirmwareStatus, setOtaFirmwareStatus } from "../src/application/ota/firmware-status-history.js"
import { queryCurrentOtaFirmware } from "../src/application/ota/query-current-ota-firmware.js"

const config = {
  confirm: { require_for_command: true, require_for_parameter_write: true, require_for_ota: true },
  credentials: {
    gen2: { token_env: "gen2-ota-test-secret" },
    gen3: { token_env: "gen3-ota-test-secret" },
  },
} as any

test("OTA 版本比较支持数字版本和 V 前缀", () => {
  assert.equal(isTargetVersionNewer("3146", "3147"), true)
  assert.equal(isTargetVersionNewer("V3.1", "V3.2"), true)
  assert.equal(isTargetVersionNewer("420", "420"), false)
  assert.equal(isTargetVersionNewer("421", "420"), false)
  assert.equal(isTargetVersionNewer(null, "420"), true)
  assert.equal(isTargetVersionLower("421", "420"), true)
  assert.equal(isTargetVersionLower("420", "421"), false)
  assert.equal(isTargetVersionLower("420", "420"), false)
})

test("OTA 确认令牌绑定固件、版本和前置检查快照", () => {
  const action = {
    kind: "ota" as const,
    generation: "gen3" as const,
    channel: "4g" as const,
    batteryId: "404573DB",
    operation: "ota-start",
    payload: {
      firmwareId: 132,
      firmwareVersion: "421",
      firmwareSerialNumber: "3",
      currentVersion: "420",
      allowDowngrade: false,
      preflight: { canStart: true, recentDataCount: 8, latestReportTime: "2026-07-14 10:00:00" },
    },
  }
  const token = createConfirmationToken(action, config).confirmationToken
  assert.doesNotThrow(() => verifyConfirmationToken(action, token, config))
  assert.throws(() => verifyConfirmationToken({ ...action, payload: { ...action.payload, firmwareId: 133 } }, token, config), /不匹配/)
  assert.throws(() => verifyConfirmationToken({ ...action, payload: { ...action.payload, currentVersion: "421" } }, token, config), /不匹配/)
  assert.throws(() => verifyConfirmationToken({ ...action, payload: { ...action.payload, allowDowngrade: true } }, token, config), /不匹配/)
})

test("OTA 只使用已验证的两代 4G 启动入口", async () => {
  const requests: Array<Record<string, unknown>> = []
  const fakeClient = {
    request: async (request: Record<string, unknown>) => {
      requests.push(request)
      return { data: { code: 200 } }
    },
  } as any

  await sendGen2OtaCommand(fakeClient, { batteryId: "959F1FDC" })
  await sendGen3OtaEnter(fakeClient, { batteryId: "404573DB", sessionId: 123 })

  assert.deepEqual(requests[0], {
    path: "/front/bl/sendbms",
    method: "GET",
    query: { batteryId: "959F1FDC", msgType: "4" },
    retryCount: 0,
  })
  assert.deepEqual(requests[1], {
    path: "/managekdb/c/command/sendCommand",
    method: "POST",
    body: { batteryId: "404573DB", sessionId: 123, msgType: "60", msgSubType: "00", useMsg: "OTA升级" },
    retryCount: 0,
  })
})

test("OTA 可以按固件版本或名称选择唯一固件，重复选择要求改用 ID", async () => {
  const fakeClient = {
    request: async () => ({
      data: {
        code: 200,
        total: 2,
        rows: [
          { id: 131, firmwareVersion: "420", serialNumber: 3 },
          { id: 132, firmwareVersion: "421", firmwareName: "目标固件", serialNumber: 3 },
        ],
      },
    }),
  } as any
  const clients = {
    config: { routing: { gen2_prefixes: ["9"], gen3_prefixes: ["4"] } },
    gen2: fakeClient,
    gen3: fakeClient,
  } as any

  const resolved = await resolveOtaFirmware({ clients, batteryId: "404573DB", firmwareVersion: "421" })
  assert.equal(resolved.firmware.id, 132)
  const named = await resolveOtaFirmware({ clients, batteryId: "404573DB", firmwareName: "目标固件" })
  assert.equal(named.firmware.id, 132)
  const duplicateClient = {
    request: async () => ({
      data: {
        code: 200,
        total: 2,
        rows: [
          { id: 141, firmwareVersion: "422", serialNumber: 3 },
          { id: 142, firmwareVersion: "422", serialNumber: 4 },
        ],
      },
    }),
  } as any
  await assert.rejects(
    resolveOtaFirmware({
      clients: { ...clients, gen3: duplicateClient },
      batteryId: "404573DB",
      firmwareVersion: "422",
    }),
    /多个候选/,
  )
  await assert.rejects(
    resolveOtaFirmware({
      clients: {
        ...clients,
        gen3: {
          request: async () => ({
            data: {
              code: 200,
              total: 2,
              rows: [
                { id: 151, firmwareVersion: "422", firmwareName: "同名固件" },
                { id: 152, firmwareVersion: "423", firmwareName: "同名固件" },
              ],
            },
          }),
        },
      } as any,
      batteryId: "404573DB",
      firmwareName: "同名固件",
    }),
    /多个候选/,
  )
})

test("固件推送状态支持预览、历史记录和回滚预览", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kdb-ota-history-"))
  const historyFile = path.join(root, "history.jsonl")
  const config = {
    app: { default_output_dor: root },
    routing: { gen2_prefixes: ["9"], gen3_prefixes: ["4"] },
    confirm: { require_for_ota: true },
    credentials: { gen2: { token_env: "g2" }, gen3: { token_env: "g3" } },
  } as any
  const firmware = { id: 120, serialNumber: 4, firmwareVersion: "470", firmwareStatus: "1", firmwareType: "2", firmwarePath: "/profile/ota" }
  const client = {
    request: async (request: any) => request.method === "PUT"
      ? { data: { code: 200 } }
      : { data: { code: 200, total: 1, rows: [{ ...firmware }] } },
  } as any
  const clients = { config, gen2: client, gen3: client } as any

  const preview = await setOtaFirmwareStatus({ clients, batteryId: "404573DB", firmwareId: "120", status: "2", historyFile })
  assert.equal(preview.status, "PREVIEW")
  if (preview.status !== "PREVIEW") throw new Error("expected firmware status preview")
  const applied = await setOtaFirmwareStatus({ clients, batteryId: "404573DB", firmwareId: "120", status: "2", historyFile, confirmationToken: preview.confirmationToken })
  assert.equal(applied.status, "APPLIED")
  const history = await listOtaFirmwareStatusHistory({ clients, batteryId: "404573DB", historyFile })
  assert.equal(history.total, 1)
  const rollback = await rollbackOtaFirmwareStatus({ clients, batteryId: "404573DB", historyFile })
  assert.equal(rollback.status, "PREVIEW")
  assert.equal(rollback.changes[0]?.beforeStatus, "2")
  assert.equal(rollback.changes[0]?.afterStatus, "1")
  await rm(root, { recursive: true, force: true })
})

test("当前固件查询按实际版本和系列号返回完整后台记录", async () => {
  const fakeClient = {
    request: async (request: any) => {
      if (request.path.includes("kdbFirmwareBase/list")) {
        return { data: { code: 200, total: 1, rows: [{ id: 120, serialNumber: 4, firmwareVersion: "V470", firmwareName: "ECM限时充电", firmwareType: "2" }] } }
      }
      if (request.path.includes("kdbBatteryBase/list")) {
        return { data: { code: 200, total: 1, rows: [{ batteryId: "404573DB", serialNumber: "4", appVersion: "470", lte4gStatus: "1" }] } }
      }
      return { data: { code: 200, total: 1, rows: [{ batteryId: "404573DB", logTime: "2026-07-14 12:00:00" }] } }
    },
  } as any
  const clients = {
    config: { routing: { gen2_prefixes: ["9"], gen3_prefixes: ["4"] } },
    gen2: fakeClient,
    gen3: fakeClient,
  } as any
  const result = await queryCurrentOtaFirmware({ clients, batteryId: "404573DB" })
  assert.equal(result.matchState, "MATCHED")
  assert.equal(result.firmware?.id, 120)
  assert.equal(result.firmware?.firmwareName, "ECM限时充电")
})

test("当前固件查询在后台版本字段不一致时按名称版本回退并标记元数据不一致", async () => {
  const fakeClient = {
    request: async (request: any) => {
      if (request.path.includes("hckdFirmwareBase/list")) {
        return {
          data: {
            code: 200,
            total: 2,
            rows: [
              { id: 151, serialNumber: 3, firmwareVersion: "3147", firmwareName: "V3046正式版", firmwareStatus: "2", firmwareType: "1" },
              { id: 154, serialNumber: 3, firmwareVersion: "3147", firmwareName: "禁止使用-V3046定位优化测试版", firmwareStatus: "1", firmwareType: "1" },
            ],
          },
        }
      }
      if (request.path.includes("hckdBatteryBase/list")) {
        return { data: { code: 200, total: 1, rows: [{ batteryId: "959F1FDC", serialNumber: "3", batteryVersion: "3046" }] } }
      }
      return { data: { code: 200, total: 0, rows: [] } }
    },
  } as any
  const clients = {
    config: { routing: { gen2_prefixes: ["9"], gen3_prefixes: ["4"] } },
    gen2: fakeClient,
    gen3: fakeClient,
  } as any
  const result = await queryCurrentOtaFirmware({ clients, batteryId: "959F1FDC" })
  assert.equal(result.matchState, "METADATA_MISMATCH")
  assert.equal(result.matchSource, "firmwareName")
  assert.equal(result.firmware?.id, 151)
  assert.equal(result.candidateCount, 2)
})
