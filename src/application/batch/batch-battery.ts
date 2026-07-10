import path from "node:path"
import type { KdbApiClients } from "../../index.js"
import { createConfirmationToken, verifyConfirmationToken, type ConfirmationAction } from "../../core/control/confirmation.js"
import { resolveGeneration } from "../../core/config/index.js"
import { type ControlChannel, resolveBatteryCommand } from "../../domain/control/command-catalog.js"
import { exportBatteryRealtimeData } from "../export/export-realtime-data.js"
import { executeBatteryCommand, normalizedBattery } from "../control/control-battery-command.js"
import { executeBatteryParameterWrite, readBatteryParameter, resolveBatteryParameter } from "../parameters/manage-battery-parameters.js"
import { parameterValue, assertWritable, validateParameterValue, type ParameterDefinition } from "../../domain/parameters/parameter-types.js"
import { queryBatteryCommandReadiness } from "../status/query-command-readiness.js"
import { queryBatteryStatusById } from "../status/query-battery-by-id.js"

export const MAX_BATCH_SIZE = 100
const BATCH_CONCURRENCY = 5

export type BatchTarget = { batteryId: string; generation: "gen2" | "gen3" }

/** Parses the local txt/csv format accepted by the CLI; de-duplication is applied with explicit IDs below. */
export function parseBatchTargetText(contents: string): string[] {
  return contents.split(/[\s,]+/).filter(Boolean)
}

export function resolveBatchTargets(clients: KdbApiClients, batteryIds: string[]): BatchTarget[] {
  const unique = [...new Set(batteryIds.map((item) => item.trim().toUpperCase()).filter(Boolean))]
  if (unique.length === 0) throw new Error("批量操作至少需要一个 --battery-id 或 --battery-file")
  if (unique.length > MAX_BATCH_SIZE) throw new Error(`单次批量操作最多 ${MAX_BATCH_SIZE} 块电池`)
  const targets = unique.map((batteryId) => ({ batteryId, generation: resolveGeneration(batteryId, clients.config) }))
  const generations = new Set(targets.map((item) => item.generation))
  if (generations.size !== 1) throw new Error("批量操作不允许混合 Gen2 与 Gen3 电池，请分代执行")
  return targets
}

async function mapConcurrent<T, R>(items: T[], mapper: (item: T) => Promise<R>, limit = BATCH_CONCURRENCY): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await mapper(items[index]!)
    }
  }))
  return results
}

function batchAction(args: {
  kind: "command" | "parameter-write"
  generation: "gen2" | "gen3"
  operation: string
  payload: Record<string, unknown>
}): ConfirmationAction {
  return { kind: args.kind, generation: args.generation, channel: "4g", batteryId: "BATCH", operation: args.operation, payload: args.payload }
}

export async function queryBatchBatteryStatus(args: { clients: KdbApiClients; batteryIds: string[] }) {
  const targets = resolveBatchTargets(args.clients, args.batteryIds)
  const results = await mapConcurrent(targets, async (target) => {
    try {
      const [status, readiness] = await Promise.all([
        queryBatteryStatusById({ clients: args.clients, ...target }),
        queryBatteryCommandReadiness({ clients: args.clients, ...target }),
      ])
      return { batteryId: target.batteryId, generation: target.generation, ok: true, status, readiness }
    } catch (error) {
      return { batteryId: target.batteryId, generation: target.generation, ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  return { targets, results }
}

export async function controlBatteryBatch(args: {
  clients: KdbApiClients
  batteryIds: string[]
  command: string
  value?: string
  confirmationToken?: string
}) {
  const targets = resolveBatchTargets(args.clients, args.batteryIds)
  const generation = targets[0]!.generation
  const command = resolveBatteryCommand(generation, "4g", args.command)
  if (command.value?.required && !args.value) throw new Error(`命令 ${command.name} 需要 --value <${command.value.name}>`)
  if (!command.value && args.value !== undefined) throw new Error(`命令 ${command.name} 不接受 --value`)
  const preflight = await mapConcurrent(targets, async (target) => {
    const readiness = await queryBatteryCommandReadiness({ clients: args.clients, ...target })
    return { ...target, ready: readiness.canSendCommand, reason: readiness.reason }
  })
  const blocked = preflight.filter((item) => !item.ready)
  if (blocked.length > 0) return { phase: "preview-blocked" as const, command, targets, preflight, message: "存在不可下发电池，未生成确认令牌，也不会下发" }
  const action = batchAction({ kind: "command", generation, operation: command.name, payload: { batteryIds: targets.map((item) => item.batteryId), ...(args.value !== undefined ? { value: args.value } : {}) } })
  if (!args.confirmationToken) return { phase: "preview" as const, action, command, targets, preflight, ...createConfirmationToken(action, args.clients.config), next: "用户明确确认后，使用完全相同目标和参数携带 --confirm 执行" }
  verifyConfirmationToken(action, args.confirmationToken, args.clients.config)
  const recheck = await mapConcurrent(targets, async (target) => ({ ...target, readiness: await queryBatteryCommandReadiness({ clients: args.clients, ...target }) }))
  const unavailable = recheck.filter((item) => !item.readiness.canSendCommand)
  if (unavailable.length > 0) return { phase: "execution-blocked" as const, targets, unavailable, message: "确认后复检发现不可下发电池，整个批次未执行" }
  const results = await mapConcurrent(targets, async (target) => {
    try {
      return { batteryId: target.batteryId, ok: true, result: await executeBatteryCommand({ clients: args.clients, ...target, channel: "4g", command, ...(args.value !== undefined ? { value: args.value } : {}) }) }
    } catch (error) {
      return { batteryId: target.batteryId, ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  return { phase: "submitted" as const, command: command.name, targets, results, status: "SENT", physicalEffectVerified: false }
}

type PreparedParameter = BatchTarget & { parameter: ParameterDefinition; oldValue: string }

async function prepareParameterWrites(args: { clients: KdbApiClients; targets: BatchTarget[]; selector: string; value: string }): Promise<{ prepared: PreparedParameter[]; blocked: Array<Record<string, string>> }> {
  const attempts = await mapConcurrent(args.targets, async (target) => {
    try {
      const found = await resolveBatteryParameter({ clients: args.clients, ...target, selector: args.selector })
      assertWritable(found.parameter)
      validateParameterValue(found.parameter, args.value)
      const read = await readBatteryParameter({ clients: args.clients, ...target, channel: "4g", selector: args.selector })
      const oldValue = parameterValue(read.parameters[0] ?? {})
      if (oldValue === undefined) throw new Error("参数读取未返回值")
      return { ok: true as const, value: { ...target, parameter: found.parameter, oldValue } }
    } catch (error) {
      return { ok: false as const, value: { batteryId: target.batteryId, error: error instanceof Error ? error.message : String(error) } }
    }
  })
  return { prepared: attempts.filter((item): item is { ok: true; value: PreparedParameter } => item.ok).map((item) => item.value), blocked: attempts.filter((item): item is { ok: false; value: { batteryId: string; error: string } } => !item.ok).map((item) => item.value) }
}

export async function readBatteryParameterBatch(args: { clients: KdbApiClients; batteryIds: string[]; selector: string }) {
  const targets = resolveBatchTargets(args.clients, args.batteryIds)
  const results = await mapConcurrent(targets, async (target) => {
    try {
      return { batteryId: target.batteryId, ok: true, result: await readBatteryParameter({ clients: args.clients, ...target, channel: "4g", selector: args.selector }) }
    } catch (error) {
      return { batteryId: target.batteryId, ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  return { targets, results }
}

export async function writeBatteryParameterBatch(args: {
  clients: KdbApiClients
  batteryIds: string[]
  selector: string
  value: string
  confirmationToken?: string
}) {
  const targets = resolveBatchTargets(args.clients, args.batteryIds)
  const generation = targets[0]!.generation
  const initial = await prepareParameterWrites({ clients: args.clients, targets, selector: args.selector, value: args.value })
  if (initial.blocked.length > 0) return { phase: "preview-blocked" as const, targets, blocked: initial.blocked, message: "存在参数不可读取/不可写/不在线的电池，未生成确认令牌" }
  const action = batchAction({ kind: "parameter-write", generation, operation: args.selector, payload: { batteryIds: targets.map((item) => item.batteryId), parameterIds: initial.prepared.map((item) => item.parameter.parameterId), oldValues: initial.prepared.map((item) => item.oldValue), newValue: args.value } })
  if (!args.confirmationToken) return { phase: "preview" as const, action, targets, changes: initial.prepared.map((item) => ({ batteryId: item.batteryId, parameterId: item.parameter.parameterId, parameterName: item.parameter.parameterName, oldValue: item.oldValue, newValue: args.value })), ...createConfirmationToken(action, args.clients.config), next: "用户明确确认后，使用完全相同目标、参数和值携带 --confirm 执行" }
  verifyConfirmationToken(action, args.confirmationToken, args.clients.config)
  const refreshed = await prepareParameterWrites({ clients: args.clients, targets, selector: args.selector, value: args.value })
  if (refreshed.blocked.length > 0 || refreshed.prepared.some((item, index) => item.oldValue !== initial.prepared[index]?.oldValue)) {
    return { phase: "execution-blocked" as const, targets, blocked: refreshed.blocked, message: "确认后参数旧值或前置条件已变化，整个批次未执行；请重新预览" }
  }
  const results = await mapConcurrent(refreshed.prepared, async (item) => {
    try {
      return { batteryId: item.batteryId, ok: true, result: await executeBatteryParameterWrite({ clients: args.clients, ...item, channel: "4g", value: args.value }) }
    } catch (error) {
      return { batteryId: item.batteryId, ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  return { phase: "submitted" as const, targets, results, status: "SENT", physicalEffectVerified: false }
}

export async function exportBatteryRealtimeBatch(args: {
  clients: KdbApiClients
  batteryIds: string[]
  outputDir: string
  start?: string
  end?: string
  hours?: number
}) {
  const targets = resolveBatchTargets(args.clients, args.batteryIds)
  const results = await mapConcurrent(targets, async (target) => {
    try {
      const outputPath = path.join(args.outputDir, `${target.batteryId}-realtime.xlsx`)
      return { batteryId: target.batteryId, ok: true, result: await exportBatteryRealtimeData({ clients: args.clients, ...target, outputPath, ...(args.start !== undefined ? { start: args.start } : {}), ...(args.end !== undefined ? { end: args.end } : {}), ...(args.hours !== undefined ? { hours: args.hours } : {}) }) }
    } catch (error) {
      return { batteryId: target.batteryId, ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  return { targets, outputDir: args.outputDir, results }
}
