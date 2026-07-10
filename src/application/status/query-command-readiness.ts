import type { KdbApiClients } from "../../index.js"
import { assertTableOk } from "../../core/api/table-data.js"
import { resolveGeneration } from "../../core/config/index.js"
import { listGen2BatteryBase } from "../../domain/gen2/status/hckd-battery-base-api.js"
import { listGen2DeviceRegisterData } from "../../domain/gen2/status/hckd-device-register-data-api.js"
import { listGen3BatteryBase } from "../../domain/gen3/status/kdb-battery-base-api.js"
import { listGen3DeviceRegisterData } from "../../domain/gen3/status/kdb-device-register-data-api.js"

export type CommandReadinessState = "READY" | "OFFLINE" | "NOT_FOUND" | "UNKNOWN"
export type RegistrationState = "REGISTERED" | "UNREGISTERED" | "INACTIVE" | "UNKNOWN"

export type BatteryCommandReadiness = {
  batteryId: string
  generation: "gen2" | "gen3"
  canSendCommand: boolean
  state: CommandReadinessState
  stateText: string
  reason: string
  networkStatus: "ONLINE" | "OFFLINE" | "UNKNOWN"
  networkStatusText: string
  networkStatusRaw?: unknown
  networkTime?: string
  registration: RegistrationState
  registrationText: string
  registrationStatusRaw?: Array<number | string>
  source: "battery-base-lte4g-status"
  realtimeCheckOnSend: true
}

function normalizeNetworkStatus(value: unknown): "ONLINE" | "OFFLINE" | "UNKNOWN" {
  if (value === 1 || value === "1") return "ONLINE"
  if (value === 2 || value === "2") return "OFFLINE"
  return "UNKNOWN"
}

function networkStatusText(status: "ONLINE" | "OFFLINE" | "UNKNOWN"): string {
  if (status === "ONLINE") return "在线"
  if (status === "OFFLINE") return "离线"
  return "未知"
}

function normalizeRegistration(rows: Array<Record<string, unknown>>): {
  state: RegistrationState
  text: string
  raw: Array<number | string>
} {
  const raw = rows
    .map((row) => row.registerStatus)
    .filter((value): value is number | string => typeof value === "number" || typeof value === "string")
  if (raw.some((value) => value === 1 || value === "1")) {
    return { state: "REGISTERED", text: "已注册", raw }
  }
  if (rows.length === 0) return { state: "UNREGISTERED", text: "未注册", raw }
  return { state: "INACTIVE", text: "无有效注册（存在历史注册记录）", raw }
}

export async function queryBatteryCommandReadiness(args: {
  clients: KdbApiClients
  batteryId: string
  generation?: "gen2" | "gen3"
}): Promise<BatteryCommandReadiness> {
  const batteryId = args.batteryId.trim().toUpperCase()
  if (!batteryId) throw new Error("batteryId 不能为空")
  const inferred = resolveGeneration(batteryId, args.clients.config)
  if (args.generation && args.generation !== inferred) {
    throw new Error(`指定代际 ${args.generation} 与电池编号 ${batteryId} 推断结果 ${inferred} 不一致`)
  }
  const generation = args.generation ?? inferred
  const query = { batteryId, pageNum: 1, pageSize: 20 }

  const basePromise =
    generation === "gen2"
      ? listGen2BatteryBase(args.clients.gen2, query)
      : listGen3BatteryBase(args.clients.gen3, query)
  const registrationPromise =
    generation === "gen2"
      ? listGen2DeviceRegisterData(args.clients.gen2, query)
      : listGen3DeviceRegisterData(args.clients.gen3, query)

  const [baseResponse, registrationResult] = await Promise.all([
    basePromise,
    registrationPromise
      .then((response) => ({ response }))
      .catch((error: unknown) => ({ error })),
  ])
  assertTableOk({ generation, action: "listBatteryBase", result: baseResponse.data })
  const baseRow = baseResponse.data.rows?.[0] as Record<string, unknown> | undefined

  let registration: RegistrationState = "UNKNOWN"
  let registrationText = "未知（注册接口不可用或无权限）"
  let registrationStatusRaw: Array<number | string> = []
  if ("response" in registrationResult) {
    assertTableOk({ generation, action: "listDeviceRegisterData", result: registrationResult.response.data })
    const normalized = normalizeRegistration(
      (registrationResult.response.data.rows ?? []) as Array<Record<string, unknown>>,
    )
    registration = normalized.state
    registrationText = normalized.text
    registrationStatusRaw = normalized.raw
  }

  if (!baseRow) {
    return {
      batteryId,
      generation,
      canSendCommand: false,
      state: "NOT_FOUND",
      stateText: "不可下发",
      reason: "电池基础表中不存在该编号",
      networkStatus: "UNKNOWN",
      networkStatusText: "未知",
      registration,
      registrationText,
      ...(registrationStatusRaw.length > 0 ? { registrationStatusRaw } : {}),
      source: "battery-base-lte4g-status",
      realtimeCheckOnSend: true,
    }
  }

  const networkStatusRaw = baseRow.lte4gStatus
  const networkStatus = normalizeNetworkStatus(networkStatusRaw)
  const networkTime = typeof baseRow.lte4gTime === "string" ? baseRow.lte4gTime : undefined
  const canSendCommand = networkStatus === "ONLINE"
  const state: CommandReadinessState =
    networkStatus === "ONLINE" ? "READY" : networkStatus === "OFFLINE" ? "OFFLINE" : "UNKNOWN"
  const reason =
    state === "READY"
      ? "电池基础表显示 4G 在线；下发时后台会再次检查实时 Netty 通道"
      : state === "OFFLINE"
        ? "电池基础表显示 4G 离线，当前不可直接下发"
        : "电池网络状态不是后台定义的 1（在线）或 2（离线）"

  return {
    batteryId,
    generation,
    canSendCommand,
    state,
    stateText: canSendCommand ? "可以下发" : "不可下发",
    reason,
    networkStatus,
    networkStatusText: networkStatusText(networkStatus),
    networkStatusRaw,
    ...(networkTime ? { networkTime } : {}),
    registration,
    registrationText,
    ...(registrationStatusRaw.length > 0 ? { registrationStatusRaw } : {}),
    source: "battery-base-lte4g-status",
    realtimeCheckOnSend: true,
  }
}
