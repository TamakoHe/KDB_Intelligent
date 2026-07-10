import type { KdbApiClients } from "../../index.js"
import { resolveGeneration } from "../../core/config/index.js"
import { queryBatteryStatus } from "./query-battery-status.js"
import type { UnifiedBatteryStatus } from "./query-battery-status.js"
import { GEN2_BATTERY_BASE_FIELD_LABELS } from "../../domain/gen2/status/hckd-battery-base-api.js"
import { GEN3_BATTERY_BASE_FIELD_LABELS } from "../../domain/gen3/status/kdb-battery-base-api.js"

export type BatteryStatusByIdResult = {
  batteryId: string
  generation: "gen2" | "gen3"
  found: boolean
  summary: Omit<UnifiedBatteryStatus, "raw"> | null
  details: Record<string, unknown> | null
  detailFieldLabels: Record<string, string>
  latestReport: Record<string, unknown> | null
  base: { total: number; rows: UnifiedBatteryStatus[] }
  latest: { total: number; rows: UnifiedBatteryStatus[] }
}

function completeDetails(
  raw: Record<string, unknown> | undefined,
  labels: Record<string, string>,
): Record<string, unknown> | null {
  if (!raw) return null
  const details: Record<string, unknown> = { ...raw }
  for (const key of Object.keys(labels)) {
    if (details[key] === undefined) details[key] = null
  }
  return details
}

export async function queryBatteryStatusById(args: {
  clients: KdbApiClients
  batteryId: string
  generation?: "gen2" | "gen3"
}): Promise<BatteryStatusByIdResult> {
  const batteryId = args.batteryId.trim().toUpperCase()
  if (!batteryId) throw new Error("batteryId 不能为空")
  const inferred = resolveGeneration(batteryId, args.clients.config)
  if (args.generation && args.generation !== inferred) {
    throw new Error(`指定代际 ${args.generation} 与电池编号 ${batteryId} 推断结果 ${inferred} 不一致`)
  }
  const generation = args.generation ?? inferred

  const result = await queryBatteryStatus({
    clients: args.clients,
    generation,
    baseQuery: { batteryId, pageNum: 1, pageSize: 20 },
    latestQuery:
      generation === "gen2"
        ? { params: { likeBatteryId: batteryId } }
        : { batteryId, pageNum: 1, pageSize: 20, orderByColumn: "logTime", isAsc: "desc" },
  })
  const firstBase = result.base.rows[0]
  const firstLatest = result.latest.rows[0]
  const detailFieldLabels =
    generation === "gen2" ? GEN2_BATTERY_BASE_FIELD_LABELS : GEN3_BATTERY_BASE_FIELD_LABELS
  const summary = firstBase
    ? Object.fromEntries(Object.entries(firstBase).filter(([key]) => key !== "raw")) as Omit<UnifiedBatteryStatus, "raw">
    : null

  return {
    batteryId,
    generation,
    found: firstBase !== undefined,
    summary,
    details: completeDetails(firstBase?.raw, detailFieldLabels),
    detailFieldLabels,
    latestReport: firstLatest?.raw ?? null,
    base: result.base,
    latest: result.latest,
  }
}
