import type { ParameterDefinition } from "../../parameters/parameter-types.js"

function hex(value: bigint, width: number): string {
  return value.toString(16).toUpperCase().padStart(width, "0").slice(-width)
}

/** Gen2 `Crc16Utils.sentStrToCrc()` appends the Modbus register high byte first. */
export function crc16Modbus(hexText: string): string {
  if (!/^[0-9A-Fa-f]+$/.test(hexText) || hexText.length % 2 !== 0) throw new Error("CRC 输入必须是偶数长度十六进制")
  let crc = 0xffff
  for (let i = 0; i < hexText.length; i += 2) {
    crc ^= Number.parseInt(hexText.slice(i, i + 2), 16)
    for (let bit = 0; bit < 8; bit++) crc = (crc & 1) !== 0 ? (crc >> 1) ^ 0xa001 : crc >> 1
  }
  return crc.toString(16).toUpperCase().padStart(4, "0")
}

function address(parameter: ParameterDefinition): string {
  const value = String(parameter.parameterAddress ?? "").replace(/^0x/i, "").toUpperCase()
  if (!/^[0-9A-F]{4}$/.test(value)) throw new Error(`无效参数地址: ${String(parameter.parameterAddress)}`)
  return value
}

function encodedValue(parameter: ParameterDefinition, value: string): string {
  const type = String(parameter.parameterDataType ?? "")
  if (type === "I32") return hex(BigInt.asUintN(32, BigInt(value)), 8)
  if (type === "U32") return hex(BigInt(value), 8)
  if (type === "F32") {
    const buffer = new ArrayBuffer(4)
    new DataView(buffer).setFloat32(0, Number(value), false)
    return [...new Uint8Array(buffer)].map((item) => item.toString(16).padStart(2, "0")).join("").toUpperCase()
  }
  throw new Error(`Gen2 蓝牙参数暂不支持数据类型 ${type}`)
}

export function buildGen2BluetoothParameterMessage(args: {
  batteryId: string
  parameter: ParameterDefinition
  sessionId: number
  value?: string
}): { msgId: "50" | "52"; msgKey: string; msgLog: string } {
  const batteryId = args.batteryId.trim().toUpperCase()
  if (!/^[0-9A-F]{8}$/.test(batteryId)) throw new Error("Gen2 参数协议要求 8 位十六进制电池编号")
  const msgKey = hex(BigInt(args.sessionId), 8)
  const msgId = args.value === undefined ? "50" : "52"
  const length = msgId === "50" ? "000A" : "000E"
  const value = args.value === undefined ? "" : encodedValue(args.parameter, args.value)
  const body = `3322${msgId}${batteryId}${length}${address(args.parameter)}0001${msgKey}${value}`
  return { msgId, msgKey, msgLog: `${body}${crc16Modbus(body)}` }
}
