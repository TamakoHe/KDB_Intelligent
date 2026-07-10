import assert from "node:assert/strict"
import test from "node:test"
import { createConfirmationToken, verifyConfirmationToken } from "../src/core/control/confirmation.js"
import { listBatteryCommands, resolveBatteryCommand } from "../src/domain/control/command-catalog.js"
import { MAX_BATCH_SIZE, parseBatchTargetText, resolveBatchTargets } from "../src/application/batch/batch-battery.js"
import { buildGen2BluetoothParameterMessage, crc16Modbus } from "../src/domain/gen2/control/hckd-parameter-protocol.js"
import { assertWritable, resolveParameter, validateParameterValue } from "../src/domain/parameters/parameter-types.js"

const config = {
  routing: { gen3_prefixes: ["4", "6"], gen2_prefixes: ["5", "8", "9"] },
  confirm: { require_for_command: true, require_for_parameter_write: true },
  credentials: {
    gen2: { token_env: "gen2-test-token" },
    gen3: { token_env: "gen3-test-token" },
  },
} as any

test("控制目录不包含 OTA，且只返回通道实际支持的命令", () => {
  assert.equal(listBatteryCommands("gen3").some((item) => /ota|upgrade/i.test(item.name)), false)
  assert.equal(resolveBatteryCommand("gen2", "bluetooth", "reset").gen2?.bluetoothOperateType, "02")
  assert.throws(() => resolveBatteryCommand("gen2", "bluetooth", "enter-storage"), /不支持命令/)
  assert.equal(resolveBatteryCommand("gen3", "4g", "应急模式").name, "mode-emergency")
  assert.equal(resolveBatteryCommand("gen2", "4g", "关机").name, "shutdown")
})

test("批量目标去重、限制数量，且拒绝跨代混批", () => {
  const clients = { config } as any
  assert.deepEqual(parseBatchTargetText("\n40457bde, 40457BDE\n\n62413828\n"), ["40457bde", "40457BDE", "62413828"])
  assert.deepEqual(resolveBatchTargets(clients, ["40457bde", "40457BDE", "62413828"]), [
    { batteryId: "40457BDE", generation: "gen3" },
    { batteryId: "62413828", generation: "gen3" },
  ])
  assert.throws(() => resolveBatchTargets(clients, ["40457BDE", "959F1FDC"]), /不允许混合/)
  assert.throws(() => resolveBatchTargets(clients, Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, index) => `4${String(index).padStart(7, "0")}`)), /最多/)
})

test("确认令牌绑定完整操作，不能用于另一块电池或另一参数值", () => {
  const action = {
    kind: "parameter-write" as const,
    generation: "gen3" as const,
    channel: "4g" as const,
    batteryId: "62413828",
    operation: "12",
    payload: { oldValue: "20", newValue: "42" },
  }
  const token = createConfirmationToken(action, config).confirmationToken
  assert.doesNotThrow(() => verifyConfirmationToken(action, token, config))
  assert.throws(
    () => verifyConfirmationToken({ ...action, payload: { oldValue: "20", newValue: "43" } }, token, config),
    /不匹配/,
  )
})

test("批量确认令牌绑定全部目标和逐块旧值", () => {
  const action = {
    kind: "parameter-write" as const, generation: "gen3" as const, channel: "4g" as const,
    batteryId: "BATCH", operation: "231",
    payload: { batteryIds: ["40457BDE", "62413828"], parameterIds: [231, 231], oldValues: ["80", "79"], newValue: "81" },
  }
  const token = createConfirmationToken(action, config).confirmationToken
  assert.doesNotThrow(() => verifyConfirmationToken(action, token, config))
  assert.throws(() => verifyConfirmationToken({ ...action, payload: { ...action.payload, oldValues: ["80", "80"] } }, token, config), /不匹配/)
  assert.throws(() => verifyConfirmationToken({ ...action, payload: { ...action.payload, batteryIds: ["62413828", "40457BDE"] } }, token, config), /不匹配/)
})

test("Gen2 蓝牙参数协议生成读取/写入消息并使用 Modbus CRC", () => {
  assert.equal(crc16Modbus("313233343536373839"), "4B37")
  const parameter = { parameterId: 12, parameterAddress: "0x2000", parameterDataType: "I32" }
  const read = buildGen2BluetoothParameterMessage({ batteryId: "8F9AE708", parameter, sessionId: 1 })
  assert.equal(read.msgId, "50")
  assert.equal(read.msgKey, "00000001")
  assert.match(read.msgLog, /^3322508F9AE708000A2000000100000001[0-9A-F]{4}$/)
  const write = buildGen2BluetoothParameterMessage({ batteryId: "8F9AE708", parameter, sessionId: 1, value: "-1" })
  assert.equal(write.msgId, "52")
  assert.match(write.msgLog, /FFFFFFFF[0-9A-F]{4}$/)
})

test("参数只能按唯一名称/别名/ID 解析，并强制 RW 与范围", () => {
  const row = { parameterId: 12, parameterName: "MaxCurrent", parameterAlias: "最大电流", parameterPower: "RW", parameterDataType: "I32", parameterMin: "1", parameterMax: "100" }
  assert.equal(resolveParameter([row], "最大电流"), row)
  const poleTemperature = { ...row, parameterName: "极柱高温触发阈值" }
  assert.equal(resolveParameter([poleTemperature], "极柱高温"), poleTemperature)
  assert.throws(() => resolveParameter([{ ...row, parameterName: "高温A" }, { ...row, parameterId: 13, parameterName: "高温B" }], "高温"), /多个参数/)
  assert.doesNotThrow(() => validateParameterValue(row, "42"))
  assert.throws(() => validateParameterValue(row, "101"), /最大值/)
  assert.throws(() => assertWritable({ ...row, parameterPower: "R" }), /只读/)
})
