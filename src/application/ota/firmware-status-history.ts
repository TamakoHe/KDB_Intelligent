import { appendFile, mkdir, readFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import type { KdbApiClients } from "../../index.js"
import { assertAjaxOk } from "../../core/api/ajax-result.js"
import { createConfirmationToken, verifyConfirmationToken, type ConfirmationAction } from "../../core/control/confirmation.js"
import { updateGen2Firmware } from "../../domain/gen2/ota/hckd-firmware-api.js"
import { updateGen3Firmware } from "../../domain/gen3/ota/kdb-firmware-api.js"
import type { FirmwareDefinition, OtaFirmwareStatusChange, OtaFirmwareStatusHistoryEntry } from "../../domain/ota/ota-types.js"
import { listOtaFirmware, normalizeOtaTarget, resolveOtaFirmware } from "./list-ota-firmware.js"

export type OtaFirmwareStatusPreview = {
  phase: "PREVIEW"
  status: "PREVIEW"
  batteryId: string
  generation: "gen2" | "gen3"
  changes: OtaFirmwareStatusChange[]
  confirmationToken: string
  expiresAt: string
  next: string
}

export type OtaFirmwareStatusApplied = {
  phase: "submitted"
  status: "APPLIED"
  operation: "SET" | "ROLLBACK"
  operationId: string
  batteryId: string
  generation: "gen2" | "gen3"
  changes: OtaFirmwareStatusChange[]
  rollbackOf?: string
}

function historyFilePath(clients: KdbApiClients, historyFile?: string): string {
  return path.resolve(historyFile ?? path.join(clients.config.app.default_output_dor, "ota-firmware-status-history.jsonl"))
}

async function readHistory(clients: KdbApiClients, historyFile?: string): Promise<OtaFirmwareStatusHistoryEntry[]> {
  try {
    const contents = await readFile(historyFilePath(clients, historyFile), "utf8")
    return contents.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        const value = JSON.parse(line) as OtaFirmwareStatusHistoryEntry
        return value.operationId && value.changes ? [value] : []
      } catch {
        return []
      }
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

export async function listOtaFirmwareStatusHistory(args: {
  clients: KdbApiClients
  batteryId?: string
  generation?: "gen2" | "gen3"
  limit?: number
  historyFile?: string
}) {
  const rows = await readHistory(args.clients, args.historyFile)
  const batteryId = args.batteryId?.trim().toUpperCase()
  const filtered = rows
    .filter((row) => !batteryId || row.batteryId === batteryId)
    .filter((row) => !args.generation || row.generation === args.generation)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return {
    historyFile: historyFilePath(args.clients, args.historyFile),
    total: filtered.length,
    entries: filtered.slice(0, args.limit ?? 50),
  }
}

async function appendHistory(args: {
  clients: KdbApiClients
  historyFile?: string
  operation: "SET" | "OTA_ACTIVATE" | "ROLLBACK"
  batteryId: string
  generation: "gen2" | "gen3"
  changes: OtaFirmwareStatusChange[]
  rollbackOf?: string
}) {
  const entry: OtaFirmwareStatusHistoryEntry = {
    operationId: randomUUID(),
    createdAt: new Date().toISOString(),
    operation: args.operation,
    result: "APPLIED",
    batteryId: args.batteryId,
    generation: args.generation,
    changes: args.changes,
    ...(args.rollbackOf ? { rollbackOf: args.rollbackOf } : {}),
  }
  const file = historyFilePath(args.clients, args.historyFile)
  await mkdir(path.dirname(file), { recursive: true })
  await appendFile(file, `${JSON.stringify(entry)}\n`, "utf8")
  return entry
}

async function updateFirmwareStatus(args: { clients: KdbApiClients; generation: "gen2" | "gen3"; firmware: FirmwareDefinition; status: string }) {
  const update = { ...args.firmware, firmwareStatus: args.status }
  const response = args.generation === "gen2"
    ? await updateGen2Firmware(args.clients.gen2, update)
    : await updateGen3Firmware(args.clients.gen3, update)
  assertAjaxOk({ generation: args.generation, action: "updateFirmwareStatus", result: response.data })
  return update
}

function statusAction(args: { operation: string; batteryId: string; generation: "gen2" | "gen3"; changes: OtaFirmwareStatusChange[] }): ConfirmationAction {
  return {
    kind: "ota",
    generation: args.generation,
    channel: "4g",
    batteryId: args.batteryId,
    operation: args.operation,
    payload: { changes: args.changes },
  }
}

export async function setOtaFirmwareStatus(args: {
  clients: KdbApiClients
  batteryId: string
  firmwareId?: string
  firmwareVersion?: string
  firmwareName?: string
  status: "1" | "2"
  generation?: "gen2" | "gen3"
  confirmationToken?: string
  historyFile?: string
}): Promise<OtaFirmwareStatusPreview | OtaFirmwareStatusApplied> {
  const target = normalizeOtaTarget(args.clients, args.batteryId, args.generation)
  const resolved = await resolveOtaFirmware({ clients: args.clients, ...target, ...(args.firmwareId ? { firmwareId: args.firmwareId } : {}), ...(args.firmwareVersion ? { firmwareVersion: args.firmwareVersion } : {}), ...(args.firmwareName ? { firmwareName: args.firmwareName } : {}) })
  const firmware = resolved.firmware
  const selector = args.firmwareId ?? args.firmwareVersion ?? args.firmwareName ?? String(firmware.id ?? "")
  const beforeStatus = String(firmware.firmwareStatus ?? "")
  if (!beforeStatus) throw new Error(`固件 ${selector} 没有可识别的当前推送状态`)
  if (beforeStatus === args.status) throw new Error(`固件 ${selector} 当前已经是状态 ${args.status}`)
  const afterFirmware = { ...firmware, firmwareStatus: args.status }
  const changes: OtaFirmwareStatusChange[] = [{ firmwareId: firmware.id ?? selector, beforeStatus, afterStatus: args.status, beforeFirmware: firmware, afterFirmware }]
  const action = statusAction({ operation: "firmware-status-set", batteryId: target.batteryId, generation: target.generation, changes })
  if (!args.confirmationToken) {
    return { phase: "PREVIEW", status: "PREVIEW", ...target, changes, ...createConfirmationToken(action, args.clients.config), next: "确认固件、旧状态和新状态后，使用完全相同参数携带 --confirm 执行" }
  }
  verifyConfirmationToken(action, args.confirmationToken, args.clients.config)
  const refreshed = await listOtaFirmware({ clients: args.clients, ...target })
  const current = refreshed.firmwares.find((item) => String(item.id) === String(firmware.id))
  if (!current || String(current.firmwareStatus ?? "") !== beforeStatus) throw new Error("确认后固件当前状态已变化，请重新预览")
  const appliedFirmware = await updateFirmwareStatus({ clients: args.clients, generation: target.generation, firmware: current, status: args.status })
  const appliedChanges = [{ ...changes[0]!, beforeFirmware: current, afterFirmware: appliedFirmware }]
  const entry = await appendHistory({ clients: args.clients, operation: "SET", ...target, changes: appliedChanges, ...(args.historyFile ? { historyFile: args.historyFile } : {}) })
  return { phase: "submitted", status: "APPLIED", operation: "SET", operationId: entry.operationId, ...target, changes: appliedChanges }
}

export async function rollbackOtaFirmwareStatus(args: {
  clients: KdbApiClients
  batteryId: string
  operationId?: string
  generation?: "gen2" | "gen3"
  confirmationToken?: string
  historyFile?: string
}): Promise<OtaFirmwareStatusPreview | OtaFirmwareStatusApplied> {
  const target = normalizeOtaTarget(args.clients, args.batteryId, args.generation)
  const history = await readHistory(args.clients, args.historyFile)
  const rolledBack = new Set(history.filter((row) => row.operation === "ROLLBACK" && row.rollbackOf).map((row) => row.rollbackOf!))
  const candidates = history.filter((row) => row.batteryId === target.batteryId && row.generation === target.generation && row.result === "APPLIED" && row.operation !== "ROLLBACK" && !rolledBack.has(row.operationId))
  const selected = args.operationId ? candidates.find((row) => row.operationId === args.operationId) : candidates.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  if (!selected) throw new Error(args.operationId ? `找不到可回滚的历史记录 ${args.operationId}` : "没有可回滚的历史记录")
  const changes = selected.changes.map((change) => ({ ...change, beforeStatus: change.afterStatus, afterStatus: change.beforeStatus, beforeFirmware: change.afterFirmware, afterFirmware: change.beforeFirmware }))
  const action = statusAction({ operation: "firmware-status-rollback", batteryId: target.batteryId, generation: target.generation, changes })
  if (!args.confirmationToken) return { phase: "PREVIEW", status: "PREVIEW", ...target, changes, ...createConfirmationToken(action, args.clients.config), next: "确认回滚目标和状态后，使用完全相同参数携带 --confirm 执行" }
  verifyConfirmationToken(action, args.confirmationToken, args.clients.config)
  const refreshed = await listOtaFirmware({ clients: args.clients, ...target })
  for (const change of changes) {
    const current = refreshed.firmwares.find((item) => String(item.id) === String(change.firmwareId))
    if (!current || String(current.firmwareStatus ?? "") !== change.beforeStatus) throw new Error(`确认后固件 ${change.firmwareId} 当前状态已变化，请重新预览`)
  }
  const appliedChanges: OtaFirmwareStatusChange[] = []
  for (const change of changes) {
    const current = refreshed.firmwares.find((item) => String(item.id) === String(change.firmwareId))!
    const appliedFirmware = await updateFirmwareStatus({ clients: args.clients, generation: target.generation, firmware: current, status: change.afterStatus })
    appliedChanges.push({ ...change, beforeFirmware: current, afterFirmware: appliedFirmware })
  }
  const entry = await appendHistory({ clients: args.clients, operation: "ROLLBACK", ...target, changes: appliedChanges, rollbackOf: selected.operationId, ...(args.historyFile ? { historyFile: args.historyFile } : {}) })
  return { phase: "submitted", status: "APPLIED", operation: "ROLLBACK", operationId: entry.operationId, ...target, changes: appliedChanges, rollbackOf: selected.operationId }
}

export async function recordOtaFirmwareStatusHistory(args: {
  clients: KdbApiClients
  batteryId: string
  generation: "gen2" | "gen3"
  changes: OtaFirmwareStatusChange[]
  historyFile?: string
}) {
  return appendHistory({ ...args, operation: "OTA_ACTIVATE" })
}

export { updateFirmwareStatus }
