import type { KdbApiClients } from "../../index.js"
import { resolveGeneration } from "../../core/config/index.js"
import { queryBatteryStatus } from "./query-battery-status.js"

export async function queryBatteryStatusById(args: {
  clients: KdbApiClients
  batteryId: string
  generation?: "gen2" | "gen3"
}) {
  const batteryId = args.batteryId.trim()
  if (!batteryId) throw new Error("batteryId 不能为空")
  const inferred = resolveGeneration(batteryId, args.clients.config)
  if (args.generation && args.generation !== inferred) {
    throw new Error(`指定代际 ${args.generation} 与电池编号 ${batteryId} 推断结果 ${inferred} 不一致`)
  }
  const generation = args.generation ?? inferred

  return queryBatteryStatus({
    clients: args.clients,
    generation,
    baseQuery: { batteryId, pageNum: 1, pageSize: 20 },
    latestQuery:
      generation === "gen2"
        ? { params: { likeBatteryId: batteryId } }
        : { batteryId, pageNum: 1, pageSize: 20, orderByColumn: "logTime", isAsc: "desc" },
  })
}
