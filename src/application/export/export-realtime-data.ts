import type { KdbApiClients } from "../../index.js"
import { resolveGeneration } from "../../core/config/index.js"
import { resolveTimeRange, type DateTimeInput } from "../../core/date-time.js"
import { exportExcel } from "./export-excel.js"

export type BatteryGeneration = "gen2" | "gen3"

export async function exportBatteryRealtimeData(args: {
  clients: KdbApiClients
  batteryId: string
  start?: DateTimeInput
  end?: DateTimeInput
  hours?: number
  generation?: BatteryGeneration
  outputPath?: string
}): Promise<{
  outputPath: string
  filename?: string
  generation: BatteryGeneration
  exportType: "realtimeMsgLog" | "cycle01MsgLog"
  start: string
  end: string
}> {
  const batteryId = args.batteryId.trim()
  if (!batteryId) throw new Error("batteryId 不能为空")

  const inferred = resolveGeneration(batteryId, args.clients.config)
  if (args.generation && args.generation !== inferred) {
    throw new Error(`指定代际 ${args.generation} 与电池编号 ${batteryId} 推断结果 ${inferred} 不一致`)
  }
  const generation = args.generation ?? inferred
  const range = resolveTimeRange({
    ...(args.start !== undefined ? { start: args.start } : {}),
    ...(args.end !== undefined ? { end: args.end } : {}),
    ...(args.hours !== undefined ? { hours: args.hours } : {}),
  })
  const exportType = generation === "gen2" ? "realtimeMsgLog" : "cycle01MsgLog"
  const timeParams =
    generation === "gen2"
      ? { beginCreateTime: range.startText, endCreateTime: range.endText }
      : { beginLogTime: range.startText, endLogTime: range.endText }

  const result = await exportExcel({
    clients: args.clients,
    generation,
    type: exportType,
    query: { batteryId, params: timeParams },
    ...(args.outputPath?.trim() ? { outputPath: args.outputPath.trim() } : {}),
  })

  return {
    ...result,
    generation,
    exportType,
    start: range.startText,
    end: range.endText,
  }
}
