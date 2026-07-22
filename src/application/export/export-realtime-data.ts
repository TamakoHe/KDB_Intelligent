import type { KdbApiClients } from "../../index.js"
import { resolveGeneration } from "../../core/config/index.js"
import { resolveTimeRange, type DateTimeInput } from "../../core/date-time.js"
import { exportExcel } from "./export-excel.js"
import { exportLocalHistory } from "./export-local-history.js"
import type { DataSource } from "../../core/data-source.js"
import { normalizeExportMaxRows } from "../../core/export/limits.js"
import ExcelJS from "exceljs"

export type BatteryGeneration = "gen2" | "gen3"

export async function exportBatteryRealtimeData(args: {
  clients: KdbApiClients
  batteryId: string
  start?: DateTimeInput
  end?: DateTimeInput
  hours?: number
  generation?: BatteryGeneration
  outputPath?: string
  source?: DataSource
  maxRows?: number
}): Promise<{
  outputPath: string
  filename?: string
  generation: BatteryGeneration
  exportType: "realtimeMsgLog" | "cycle01MsgLog"
  start: string
  end: string
  source: "api" | "local"
  rowCount?: number
  fallbackFrom?: "api-empty"
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

  const source = args.source ?? "api"
  const maxRows = normalizeExportMaxRows(args.maxRows)
  if (source === "local") {
    const local = await exportLocalHistory({
      clients: args.clients,
      generation,
      type: exportType,
      batteryId,
      start: range.startText,
      end: range.endText,
      maxRows,
      ...(args.outputPath?.trim() ? { outputPath: args.outputPath.trim() } : {}),
    })
    return { ...local, generation, exportType, start: range.startText, end: range.endText }
  }

  const result = await exportExcel({
    clients: args.clients,
    generation,
    type: exportType,
    query: { batteryId, params: timeParams },
    maxRows,
    ...(args.outputPath?.trim() ? { outputPath: args.outputPath.trim() } : {}),
  })

  if (source !== "auto") {
    return {
      ...result,
      generation,
      exportType,
      start: range.startText,
      end: range.endText,
      source: "api",
    }
  }

  const rowCount = await xlsxDataRowCount(result.outputPath)
  if (rowCount === 0) {
    const local = await exportLocalHistory({
      clients: args.clients,
      generation,
      type: exportType,
      batteryId,
      start: range.startText,
      end: range.endText,
      outputPath: result.outputPath,
      maxRows,
    })
    return { ...local, generation, exportType, start: range.startText, end: range.endText, fallbackFrom: "api-empty" }
  }
  return {
    ...result,
    generation,
    exportType,
    start: range.startText,
    end: range.endText,
    source: "api",
    rowCount,
  }
}

async function xlsxDataRowCount(filePath: string): Promise<number> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)
  const sheet = workbook.worksheets[0]
  return sheet ? Math.max(0, sheet.rowCount - 1) : 0
}
