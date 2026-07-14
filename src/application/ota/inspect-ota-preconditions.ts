import type { KdbApiClients } from "../../index.js"
import { resolveTimeRange } from "../../core/date-time.js"
import { queryBatteryCommandReadiness } from "../status/query-command-readiness.js"
import { queryBatteryStatusById } from "../status/query-battery-by-id.js"
import { queryBatteryStatus as queryStatus } from "../status/query-battery-status.js"
import { resolveOtaFirmware, normalizeOtaTarget } from "./list-ota-firmware.js"
import type { FirmwareDefinition, OtaPreflightResult } from "../../domain/ota/ota-types.js"

function text(value: unknown): string | null {
  return value === undefined || value === null || String(value).trim() === "" ? null : String(value)
}

function number(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function versionParts(value: string | null): number[] {
  if (!value) return []
  return value.match(/\d+/g)?.map(Number) ?? []
}

export function isTargetVersionNewer(current: string | null, target: string | null): boolean {
  if (!target) return false
  if (!current) return true
  const left = versionParts(current)
  const right = versionParts(target)
  if (left.length === 0 || right.length === 0) return target !== current
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index++) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    if (b !== a) return b > a
  }
  return false
}

async function recentDataCount(args: { clients: KdbApiClients; batteryId: string; generation: "gen2" | "gen3"; minutes: number }) {
  const range = resolveTimeRange({ hours: args.minutes / 60 })
  const result = await queryStatus({
    clients: args.clients,
    generation: args.generation,
    baseQuery: { batteryId: args.batteryId, pageNum: 1, pageSize: 1 },
    latestQuery: args.generation === "gen2"
      ? { params: { likeBatteryId: args.batteryId, beginCreateTime: range.startText, endCreateTime: range.endText } }
      : { batteryId: args.batteryId, beginLogTime: range.startText, endLogTime: range.endText, pageNum: 1, pageSize: 1 },
  })
  return result.latest.total
}

export async function inspectOtaPreconditions(args: {
  clients: KdbApiClients
  batteryId: string
  firmwareId?: string
  firmwareVersion?: string
  firmwareName?: string
  generation?: "gen2" | "gen3"
  preflightMinutes?: number
  minDataCount?: number
}): Promise<{ target: ReturnType<typeof normalizeOtaTarget>; firmware: FirmwareDefinition; preflight: OtaPreflightResult; status: Awaited<ReturnType<typeof queryBatteryStatusById>> }> {
  const target = normalizeOtaTarget(args.clients, args.batteryId, args.generation)
  const [firmwareInfo, status, readiness] = await Promise.all([
    resolveOtaFirmware({ clients: args.clients, ...target, ...(args.firmwareId ? { firmwareId: args.firmwareId } : {}), ...(args.firmwareVersion ? { firmwareVersion: args.firmwareVersion } : {}), ...(args.firmwareName ? { firmwareName: args.firmwareName } : {}) }),
    queryBatteryStatusById({ clients: args.clients, ...target }),
    queryBatteryCommandReadiness({ clients: args.clients, ...target }),
  ])
  const firmware = firmwareInfo.firmware
  const blockedReasons: string[] = []
  const warnings: string[] = []
  const summary = status.summary
  const details = status.details ?? {}
  const currentVersion = text(summary?.firmwareVersion ?? details[target.generation === "gen2" ? "batteryVersion" : "appVersion"])
  const targetVersion = text(firmware.firmwareVersion)
  const firmwareSerialNumber = text(firmware.serialNumber)
  const batterySerialNumber = text(summary?.serialNumber ?? details.serialNumber)
  const firmwareStatus = text(firmware.firmwareStatus)
  const firmwareType = text(firmware.firmwareType)
  const recentCount = await recentDataCount({
    clients: args.clients,
    ...target,
    minutes: args.preflightMinutes ?? args.clients.config.defaults.ota.preflight_minutes,
  })
  const latestReportTime = text(status.latestReport?.logTime ?? status.latestRealtime?.logTime ?? details.lte4gTime)

  if (!status.found) blockedReasons.push("基础表中不存在该电池")
  if (!readiness.canSendCommand) blockedReasons.push(`当前 4G 不可下发：${readiness.reason}`)
  if (!isTargetVersionNewer(currentVersion, targetVersion)) blockedReasons.push("目标固件版本不高于当前版本")
  if (!firmwareSerialNumber || !batterySerialNumber || firmwareSerialNumber !== batterySerialNumber) blockedReasons.push("固件产品系列号与电池不匹配")
  // Gen2 的后台字典明确规定 1=网络主固件、2=蓝牙固件。
  // Gen3 的已验证 OTA 流程按系列号/激活状态选择固件，网站字典中 firmwareType 的标签与 Gen2 不同，
  // 因此不能把 Gen2 的数值映射直接套到 Gen3，否则会误拒绝网站显示为“网络”的 Gen3 固件。
  if (target.generation === "gen2" && firmwareType !== null && firmwareType !== "1") blockedReasons.push("目标固件不是 Gen2 网络主固件类型")
  if (!firmware.firmwarePath) blockedReasons.push("目标固件没有可用文件路径")
  // 最近实时数据只作为诊断字段返回，不再作为 OTA 前置阻塞条件；是否在线由 readiness 和后台下发接口判断。
  const warrantyStatus = number(summary?.warrantyStatus ?? details.warrantyStatus)
  if (target.generation === "gen2" && warrantyStatus !== null && warrantyStatus > 3) {
    // Gen2 网站只对 roleId=7（立合账号）限制 warranty_status > 3；CLI 无法可靠获知后台角色，
    // 因此与网站保持一致，不在本地提前拦截，最终由后台账号权限决定是否接受下发。
    warnings.push(`Gen2 质保状态为 ${warrantyStatus}，是否允许 OTA 由后台账号权限决定`)
  }
  if (firmwareStatus !== null && firmwareStatus !== "2") warnings.push(`目标固件当前状态为 ${firmwareStatus}，确认后需要激活推送状态`)
  if (summary?.faultStatus !== undefined && ["1", "102"].includes(String(summary.faultStatus))) warnings.push(`当前故障状态为 ${summary.faultStatus}`)

  return {
    target,
    firmware,
    status,
    preflight: {
      canStart: blockedReasons.length === 0,
      batteryId: target.batteryId,
      generation: target.generation,
      currentVersion,
      targetVersion,
      firmwareId: firmware.id ?? args.firmwareVersion ?? args.firmwareId ?? "",
      firmwareName: text(firmware.firmwareName),
      firmwareStatus,
      firmwareType,
      firmwareSerialNumber,
      batterySerialNumber,
      networkStatus: text(readiness.networkStatus),
      latestReportTime,
      recentDataCount: recentCount,
      blockedReasons,
      warnings,
    },
  }
}
