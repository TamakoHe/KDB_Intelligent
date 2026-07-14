import type { KdbApiClients } from "../../index.js"
import { queryBatteryStatusById } from "../status/query-battery-by-id.js"
import type { FirmwareDefinition } from "../../domain/ota/ota-types.js"
import { listOtaFirmware, normalizeOtaTarget } from "./list-ota-firmware.js"

function text(value: unknown): string | null {
  return value === undefined || value === null || String(value).trim() === "" ? null : String(value)
}

function normalizeVersion(value: string): string {
  return value.trim().toLowerCase().replace(/^v/, "")
}

function nameContainsVersion(name: string, version: string): boolean {
  const target = normalizeVersion(version)
  if (!target) return false
  return (name.match(/\d+/g) ?? []).some((part) => part === target)
}

export async function queryCurrentOtaFirmware(args: {
  clients: KdbApiClients
  batteryId: string
  generation?: "gen2" | "gen3"
}) {
  const target = normalizeOtaTarget(args.clients, args.batteryId, args.generation)
  const [status, listed] = await Promise.all([
    queryBatteryStatusById({ clients: args.clients, ...target }),
    listOtaFirmware({ clients: args.clients, ...target }),
  ])
  const details = status.details ?? {}
  const currentVersion = text(status.summary?.firmwareVersion ?? details[target.generation === "gen2" ? "batteryVersion" : "appVersion"])
  const serialNumber = text(status.summary?.serialNumber ?? details.serialNumber)
  const versionMatches = currentVersion
    ? listed.firmwares.filter((firmware) => normalizeVersion(String(firmware.firmwareVersion ?? "")) === normalizeVersion(currentVersion))
    : []
  const serialMatches = serialNumber
    ? versionMatches.filter((firmware) => String(firmware.serialNumber ?? "") === serialNumber)
    : versionMatches
  const exactCandidates = serialMatches.length > 0 ? serialMatches : versionMatches
  if (exactCandidates.length === 1) {
    return {
      ...target,
      found: status.found,
      currentVersion,
      versionField: target.generation === "gen2" ? "battery_version" as const : "app_version" as const,
      serialNumber,
      firmware: exactCandidates[0]!,
      candidateCount: exactCandidates.length,
      candidates: exactCandidates,
      matchState: "MATCHED" as const,
      matchSource: "firmwareVersion" as const,
      message: "已根据电池实际上报版本和系列号匹配到后台固件记录",
    }
  }

  if (exactCandidates.length > 1) {
    return {
      ...target,
      found: status.found,
      currentVersion,
      versionField: target.generation === "gen2" ? "battery_version" as const : "app_version" as const,
      serialNumber,
      firmware: null,
      candidateCount: exactCandidates.length,
      candidates: exactCandidates,
      matchState: "AMBIGUOUS" as const,
      matchSource: "firmwareVersion" as const,
      message: "同一版本存在多个固件记录，请结合系列号或固件 ID 进一步选择",
    }
  }

  const nameVersionMatches = currentVersion
    ? listed.firmwares.filter((firmware) => nameContainsVersion(String(firmware.firmwareName ?? ""), currentVersion))
    : []
  const serialNameMatches = serialNumber
    ? nameVersionMatches.filter((firmware) => String(firmware.serialNumber ?? "") === serialNumber)
    : nameVersionMatches
  const nameCandidates = serialNameMatches.length > 0 ? serialNameMatches : nameVersionMatches
  const activeNameCandidates = nameCandidates.filter((firmware) => String(firmware.firmwareStatus ?? "") === "2")
  const preferredNameCandidates = activeNameCandidates.length > 0 ? activeNameCandidates : nameCandidates
  const firmware: FirmwareDefinition | null = preferredNameCandidates.length === 1 ? preferredNameCandidates[0]! : null
  return {
    ...target,
    found: status.found,
    currentVersion,
    versionField: target.generation === "gen2" ? "battery_version" as const : "app_version" as const,
    serialNumber,
    firmware,
    candidateCount: nameCandidates.length,
    candidates: nameCandidates,
    matchState: firmware ? "METADATA_MISMATCH" as const : nameCandidates.length > 1 ? "AMBIGUOUS" as const : "NOT_FOUND" as const,
    matchSource: firmware ? "firmwareName" as const : null,
    message: firmware
      ? `设备实际上报版本 ${currentVersion}；通过固件名称找到后台记录，但其 firmwareVersion 为 ${firmware.firmwareVersion ?? "空"}，请核对后台元数据`
      : nameCandidates.length > 1
        ? "固件名称中的版本号对应多个记录，请结合固件状态或固件 ID 进一步确认"
        : "后台固件表中没有与电池当前版本匹配的记录",
  }
}
