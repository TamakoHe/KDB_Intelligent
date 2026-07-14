import type { KdbApiClients } from "../../index.js"
import { assertTableOk } from "../../core/api/table-data.js"
import { queryBatteryCommandResult } from "../control/control-battery-command.js"
import { queryBatteryStatusById } from "../status/query-battery-by-id.js"
import { listGen3OtaUpgradeLogs, type Gen3OtaUpgradeLogRow } from "../../domain/gen3/ota/kdb-ota-upgrade-log-api.js"
import { listOtaFirmware, normalizeOtaTarget } from "./list-ota-firmware.js"
import type { OtaResult, OtaStatus } from "../../domain/ota/ota-types.js"

function text(value: unknown): string | null {
  return value === undefined || value === null || String(value).trim() === "" ? null : String(value)
}

function sameVersion(left: string | null, right: string | null): boolean {
  if (!left || !right) return false
  const normalize = (value: string) => value.trim().toLowerCase().replace(/^v/, "")
  if (normalize(left) === normalize(right)) return true
  const leftParts = left.match(/\d+/g)
  const rightParts = right.match(/\d+/g)
  return Boolean(leftParts && rightParts && leftParts.join(".") === rightParts.join("."))
}

function statusFromLog(value: unknown): OtaStatus | null {
  const status = String(value ?? "")
  if (["2", "SUCCESS", "SUCCEEDED", "成功"].includes(status.toUpperCase())) return "SUCCEEDED"
  if (["3", "FAIL", "FAILED", "失败"].includes(status.toUpperCase())) return "FAILED"
  if (["1", "RUNNING", "升级中"].includes(status.toUpperCase())) return "RUNNING"
  return null
}

function latestLog(rows: Gen3OtaUpgradeLogRow[], targetVersion?: string): Gen3OtaUpgradeLogRow | undefined {
  if (rows.length === 0) return undefined
  if (!targetVersion) return rows[0]
  return rows.find((row) => String(row.upgradeVersion ?? "") === targetVersion) ?? rows[0]
}

export async function queryOtaResult(args: {
  clients: KdbApiClients
  batteryId: string
  generation?: "gen2" | "gen3"
  sessionId?: number
  firmwareId?: string
  targetVersion?: string
}): Promise<OtaResult> {
  const target = normalizeOtaTarget(args.clients, args.batteryId, args.generation)
  const status = await queryBatteryStatusById({ clients: args.clients, ...target })
  const currentVersion = text(status.summary?.firmwareVersion ?? status.details?.[target.generation === "gen2" ? "batteryVersion" : "appVersion"])
  const versionSnapshot = {
    batteryId: target.batteryId,
    generation: target.generation,
    currentVersion,
    versionField: target.generation === "gen2" ? "battery_version" as const : "app_version" as const,
    networkStatus: text(status.summary?.networkStatus),
    networkTime: text(status.summary?.networkTime),
    latestReportTime: text(status.latestReport?.logTime ?? status.latestRealtime?.logTime),
  }

  if (target.generation === "gen3") {
    if (!args.sessionId) throw new Error("Gen3 OTA 结果需要 --session-id")
    const [command, logs] = await Promise.all([
      queryBatteryCommandResult({ clients: args.clients, ...target, sessionId: args.sessionId }),
      listGen3OtaUpgradeLogs(args.clients.gen3, { batteryId: target.batteryId, pageNum: 1, pageSize: 20, orderByColumn: "id", isAsc: "desc" }),
    ])
    assertTableOk({ generation: "gen3", action: "listOtaUpgradeLogs", result: logs.data })
    const log = latestLog((logs.data.rows ?? []) as Gen3OtaUpgradeLogRow[], args.targetVersion)
    const logStatus = statusFromLog(log?.upgradeStatus)
    const targetVersion = text(args.targetVersion ?? log?.upgradeVersion)
    const succeeded = Boolean(targetVersion && sameVersion(currentVersion, targetVersion) && (logStatus === "SUCCEEDED" || logStatus === null))
    const finalStatus: OtaStatus = succeeded ? "SUCCEEDED" : logStatus ?? (command.protocolAcknowledged ? "ACKNOWLEDGED" : "PENDING")
    return {
      ...target,
      sessionId: args.sessionId,
      ...(args.firmwareId ? { firmwareId: args.firmwareId } : {}),
      ...(targetVersion !== null ? { targetVersion } : {}),
      currentVersion,
      status: finalStatus,
      protocolAcknowledged: command.protocolAcknowledged,
      physicalEffectVerified: succeeded,
      startedAt: text(log?.upgradeStartTime),
      finishedAt: text(log?.upgradeOverTime),
      durationMs: log?.upgradeDuration ?? null,
      message: succeeded ? "OTA 升级已通过版本和后台记录确认成功" : logStatus === "FAILED" ? "后台 OTA 记录显示升级失败" : "尚未获得升级完成证据，请稍后重试",
      otaLog: (log as Record<string, unknown> | undefined) ?? null,
      versionSnapshot,
    }
  }

  const firmware = args.firmwareId ? (await listOtaFirmware({ clients: args.clients, ...target })).firmwares.find((item) => String(item.id) === args.firmwareId) : undefined
  const targetVersion = text(args.targetVersion ?? firmware?.firmwareVersion)
  const succeeded = Boolean(targetVersion && sameVersion(currentVersion, targetVersion))
  return {
    ...target,
    ...(args.firmwareId ? { firmwareId: args.firmwareId } : {}),
    ...(targetVersion !== null ? { targetVersion } : {}),
    currentVersion,
    status: succeeded ? "SUCCEEDED" : "PENDING",
    protocolAcknowledged: false,
    physicalEffectVerified: succeeded,
    message: succeeded ? "OTA 升级已通过电池版本确认成功" : "Gen2 尚未获得版本变化证据，请稍后重试",
    otaLog: null,
    versionSnapshot,
  }
}
