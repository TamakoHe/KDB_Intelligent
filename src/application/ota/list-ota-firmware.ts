import type { KdbApiClients } from "../../index.js"
import { resolveGeneration } from "../../core/config/index.js"
import { assertTableOk } from "../../core/api/table-data.js"
import { listGen2Firmwares } from "../../domain/gen2/ota/hckd-firmware-api.js"
import { listGen3Firmwares } from "../../domain/gen3/ota/kdb-firmware-api.js"
import type { FirmwareDefinition } from "../../domain/ota/ota-types.js"
import type { DataSource } from "../../core/data-source.js"
import { createLocalHistoryRepository } from "../../domain/local/local-history-repository.js"

function normalizeId(value: string): string {
  const id = value.trim().toUpperCase()
  if (!id) throw new Error("batteryId 不能为空")
  return id
}

function normalizeVersion(value: string): string {
  return value.trim().toLowerCase().replace(/^v/, "")
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

export function normalizeOtaTarget(clients: KdbApiClients, batteryId: string, generation?: "gen2" | "gen3") {
  const normalized = normalizeId(batteryId)
  const inferred = resolveGeneration(normalized, clients.config)
  if (generation && generation !== inferred) throw new Error(`指定代际 ${generation} 与电池编号 ${normalized} 推断结果 ${inferred} 不一致`)
  return { batteryId: normalized, generation: generation ?? inferred }
}

export async function listOtaFirmware(args: {
  clients: KdbApiClients
  batteryId: string
  generation?: "gen2" | "gen3"
  firmwareVersion?: string
  firmwareName?: string
  source?: DataSource
}): Promise<{
  batteryId: string; generation: "gen2" | "gen3"; total: number; firmwares: FirmwareDefinition[]
  source: "api" | "local"; isHistorical?: true; asOf?: string | null; fallbackFrom?: "api-empty"
}> {
  const target = normalizeOtaTarget(args.clients, args.batteryId, args.generation)
  if (args.source === "local") return listLocalOtaFirmware({ ...args, ...target })
  const query: Record<string, unknown> = { pageNum: 1, pageSize: 1000 }
  if (args.firmwareVersion) query.firmwareVersion = args.firmwareVersion
  if (args.firmwareName) query.firmwareName = args.firmwareName
  const response = target.generation === "gen2"
    ? await listGen2Firmwares(args.clients.gen2, query)
    : await listGen3Firmwares(args.clients.gen3, query)
  assertTableOk({ generation: target.generation, action: "listOtaFirmware", result: response.data })
  const rows = (response.data.rows ?? []) as FirmwareDefinition[]
  if (args.source === "auto" && rows.length === 0) {
    const local = await listLocalOtaFirmware({ ...args, ...target })
    return { ...local, fallbackFrom: "api-empty" as const }
  }
  return { ...target, total: Number(response.data.total ?? rows.length), firmwares: rows, source: "api" as const }
}

async function listLocalOtaFirmware(args: {
  clients: KdbApiClients; batteryId: string; generation: "gen2" | "gen3"; firmwareVersion?: string; firmwareName?: string
}) {
  const rows = await createLocalHistoryRepository(args.clients.config).listFirmwares({ generation: args.generation, ...(args.firmwareVersion ? { firmwareVersion: args.firmwareVersion } : {}), ...(args.firmwareName ? { firmwareName: args.firmwareName } : {}) })
  const asOf = rows.reduce<string | null>((latest, row) => String(row.updateTime ?? row.createTime ?? latest ?? "") || latest, null)
  return { batteryId: args.batteryId, generation: args.generation, total: rows.length, firmwares: rows as FirmwareDefinition[], source: "local" as const, isHistorical: true as const, asOf }
}

export async function resolveOtaFirmware(args: {
  clients: KdbApiClients
  batteryId: string
  generation?: "gen2" | "gen3"
  firmwareId?: string
  firmwareVersion?: string
  firmwareName?: string
}) {
  const hasId = Boolean(args.firmwareId?.trim())
  const hasVersion = Boolean(args.firmwareVersion?.trim())
  const hasName = Boolean(args.firmwareName?.trim())
  if ([hasId, hasVersion, hasName].filter(Boolean).length !== 1) {
    throw new Error("必须且只能提供 --firmware-id、--firmware-version 或 --firmware-name 其中一个")
  }
  const listed = await listOtaFirmware({ clients: args.clients, batteryId: args.batteryId, ...(args.generation ? { generation: args.generation } : {}) })
  const selector = args.firmwareId?.trim() ?? args.firmwareVersion?.trim() ?? args.firmwareName!.trim()
  const matches = hasId
    ? listed.firmwares.filter((firmware) => String(firmware.id ?? "") === selector)
    : hasVersion
      ? listed.firmwares.filter((firmware) => normalizeVersion(String(firmware.firmwareVersion ?? "")) === normalizeVersion(selector))
      : listed.firmwares.filter((firmware) => normalizeName(String(firmware.firmwareName ?? "")) === normalizeName(selector))
  const selectorText = hasId ? `ID ${selector}` : hasVersion ? `版本 ${selector}` : `名称 ${selector}`
  if (matches.length === 0) throw new Error(`找不到固件${selectorText}；请先运行 battery ota firmware list`)
  if (matches.length > 1) throw new Error(`固件${selectorText}对应多个候选，请改用 --firmware-id 指定唯一固件`)
  return { ...listed, firmware: matches[0]! }
}
