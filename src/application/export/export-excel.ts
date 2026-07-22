import path from "path"
import ExcelJS from "exceljs"
import type { KdbApiClients } from "../../index.js"
import type { RuntimeConfig } from "../../core/config/index.js"
import type { QueryObject } from "../../core/http/http-client.js"
import { getDefaultOutputDir, parseFilenameFromContentDisposition, saveArrayBuffer } from "../../core/export/download.js"
import { exportGen2BatteryBase } from "../../domain/gen2/status/hckd-battery-base-api.js"
import { exportGen2LatestBatteryTable } from "../../domain/gen2/status/hckd-battery-data-api.js"
import { exportGen2NettyLog } from "../../domain/gen2/logs/hckd-netty-log-api.js"
import { exportGen2StatusNettyLog } from "../../domain/gen2/logs/hckd-status-netty-log-api.js"
import { exportGen2BluetoothCommandTasks } from "../../domain/gen2/logs/hckd-bluetooth-command-tasks-api.js"
import { exportGen2RealtimeMsgLog } from "../../domain/gen2/logs/hckd-realtime-msg-log-api.js"
import { exportGen3BatteryBase } from "../../domain/gen3/status/kdb-battery-base-api.js"
import { exportGen3ReportBatteryLog } from "../../domain/gen3/logs/kdb-report-battery-log-api.js"
import { exportGen3Cycle01MsgLog } from "../../domain/gen3/logs/kdb-cycle01-msg-log-api.js"
import { exportGen3StatusCommandLog } from "../../domain/gen3/logs/kdb-status-command-log-api.js"
import { exportLocalHistory } from "./export-local-history.js"
import type { DataSource } from "../../core/data-source.js"
import { normalizeExportMaxRows } from "../../core/export/limits.js"
import { formatLocalDateTime, parseDateTime } from "../../core/date-time.js"

export type Generation = "gen2" | "gen3"

export type ExportType =
  | "batteryBase"
  | "latestBatteryTable"
  | "nettyLog"
  | "statusNettyLog"
  | "bluetoothCommandTasks"
  | "realtimeMsgLog"
  | "reportBatteryLog"
  | "cycle01MsgLog"
  | "statusCommandLog"

/** The website export endpoints cap one response at 8000 data rows. */
export const API_EXPORT_MAX_ROWS = 8_000

function nowCompact(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function defaultName(generation: Generation, type: ExportType): string {
  return `${generation}-${type}-${nowCompact()}.xlsx`
}

function getRuntimeConfigFromClients(clients: KdbApiClients): RuntimeConfig {
  return clients.config as unknown as RuntimeConfig
}

export async function exportExcel(args: {
  clients: KdbApiClients
  generation: Generation
  type: ExportType
  query?: QueryObject
  outputPath?: string
  source?: DataSource
  maxRows?: number
}): Promise<{ outputPath: string; filename?: string; source: "api" | "local"; rowCount?: number; fallbackFrom?: "api-empty" }> {
  const cfg = getRuntimeConfigFromClients(args.clients)
  const defaultDir = getDefaultOutputDir(cfg)
  const source = args.source ?? "api"
  const maxRows = normalizeExportMaxRows(args.maxRows)
  const queryRecord = (args.query ?? {}) as Record<string, unknown>
  const params = (queryRecord.params ?? {}) as Record<string, unknown>
  const batteryId = typeof queryRecord.batteryId === "string"
    ? queryRecord.batteryId
    : typeof params.likeBatteryId === "string" ? params.likeBatteryId : undefined
  const start = typeof params.beginLogTime === "string" ? params.beginLogTime : typeof params.beginCreateTime === "string" ? params.beginCreateTime : undefined
  const end = typeof params.endLogTime === "string" ? params.endLogTime : typeof params.endCreateTime === "string" ? params.endCreateTime : undefined
  if (source === "local") {
    return exportLocalHistory({ clients: args.clients, generation: args.generation, type: args.type, ...(batteryId ? { batteryId } : {}), ...(start ? { start } : {}), ...(end ? { end } : {}), ...(args.outputPath ? { outputPath: args.outputPath } : {}), maxRows })
  }

  const client = args.clients.getClient(args.generation)
  const chunks = await requestApiChunks({ client, generation: args.generation, type: args.type, query: args.query ?? {}, maxRows, ...(start ? { start } : {}), ...(end ? { end } : {}) })
  const filename = parseFilenameFromContentDisposition(chunks[0]!.headers.get("content-disposition"))

  const finalOutputPath =
    args.outputPath?.trim() ||
    path.join(defaultDir, filename ?? defaultName(args.generation, args.type))

  const rowCount = Math.min(maxRows, chunks.reduce((total, chunk) => total + chunk.rowCount, 0))
  const data = chunks.length === 1 && chunks[0]!.rowCount <= maxRows
    ? chunks[0]!.data
    : await mergeApiWorkbooks(chunks.map((chunk) => chunk.data), maxRows)
  await saveArrayBuffer({ outputPath: finalOutputPath, data })
  if (source !== "auto") {
    return filename ? { outputPath: finalOutputPath, filename, source: "api", rowCount } : { outputPath: finalOutputPath, source: "api", rowCount }
  }

  if (rowCount === 0) {
    const local = await exportLocalHistory({ clients: args.clients, generation: args.generation, type: args.type, ...(batteryId ? { batteryId } : {}), ...(start ? { start } : {}), ...(end ? { end } : {}), outputPath: finalOutputPath, maxRows })
    return { ...local, fallbackFrom: "api-empty" }
  }
  return filename ? { outputPath: finalOutputPath, filename, source: "api", rowCount } : { outputPath: finalOutputPath, source: "api", rowCount }
}

type ApiExportResponse = { data: ArrayBuffer; headers: Headers; rowCount: number }

async function requestApiChunks(args: {
  client: KdbApiClients["gen2"]
  generation: Generation
  type: ExportType
  query: QueryObject
  maxRows: number
  start?: string
  end?: string
}): Promise<ApiExportResponse[]> {
  const chunkable = Boolean(args.start && args.end && isTimeChunkable(args.type))
  if (!chunkable) return [await requestApiChunk({ ...args, query: { ...args.query, pageSize: Math.min(API_EXPORT_MAX_ROWS, args.maxRows) } })]

  const start = parseDateTime(args.start!, "开始时间")
  const end = parseDateTime(args.end!, "结束时间")
  const chunks: ApiExportResponse[] = []
  await collectApiRange({ ...args, start, end, chunks, remaining: args.maxRows })
  return chunks.length > 0 ? chunks : [await requestApiChunk({ ...args, query: { ...args.query, pageSize: Math.min(API_EXPORT_MAX_ROWS, args.maxRows) } })]
}

async function collectApiRange(args: {
  client: KdbApiClients["gen2"]
  generation: Generation
  type: ExportType
  query: QueryObject
  maxRows: number
  start: Date
  end: Date
  chunks: ApiExportResponse[]
  remaining: number
}): Promise<void> {
  if (args.remaining <= 0) return
  const pageSize = Math.min(API_EXPORT_MAX_ROWS, args.remaining)
  const query = withTimeRange({ ...args.query, pageSize }, args.generation, args.start, args.end)
  const chunk = await requestApiChunk({ ...args, query })
  const capped = chunk.rowCount >= API_EXPORT_MAX_ROWS && pageSize === API_EXPORT_MAX_ROWS
  const split = splitTimeRange(args.start, args.end)
  if (capped && split) {
    const before = args.chunks.length
    await collectApiRange({ ...args, end: split.leftEnd, chunks: args.chunks, remaining: args.remaining })
    const leftRows = args.chunks.slice(before).reduce((total, item) => total + item.rowCount, 0)
    await collectApiRange({ ...args, start: split.rightStart, chunks: args.chunks, remaining: Math.max(0, args.remaining - leftRows) })
    return
  }
  args.chunks.push(chunk)
}

function isTimeChunkable(type: ExportType): boolean {
  return type === "nettyLog" || type === "statusNettyLog" || type === "bluetoothCommandTasks" || type === "realtimeMsgLog" || type === "reportBatteryLog" || type === "cycle01MsgLog" || type === "statusCommandLog"
}

function withTimeRange(query: QueryObject, generation: Generation, start: Date, end: Date): QueryObject {
  const params = { ...((query.params ?? {}) as Record<string, string | number | boolean | null | undefined>) }
  const startKey = generation === "gen2" ? "beginCreateTime" : "beginLogTime"
  const endKey = generation === "gen2" ? "endCreateTime" : "endLogTime"
  params[startKey] = formatLocalDateTime(start)
  params[endKey] = formatLocalDateTime(end)
  return { ...query, params }
}

function splitTimeRange(start: Date, end: Date): { leftEnd: Date; rightStart: Date } | undefined {
  const totalSeconds = Math.floor((end.getTime() - start.getTime()) / 1000)
  if (totalSeconds < 2) return undefined
  const leftSeconds = Math.max(1, Math.floor(totalSeconds / 2))
  const rightStart = new Date(start.getTime() + leftSeconds * 1000)
  const leftEnd = new Date(rightStart.getTime() - 1000)
  return { leftEnd, rightStart }
}

async function requestApiChunk(args: {
  client: KdbApiClients["gen2"]
  generation: Generation
  type: ExportType
  query: QueryObject
}): Promise<ApiExportResponse> {
  let res: { data: ArrayBuffer; status: number; headers: Headers }
  if (args.generation === "gen2") {
    if (args.type === "batteryBase") res = await exportGen2BatteryBase(args.client, args.query)
    else if (args.type === "latestBatteryTable") res = await exportGen2LatestBatteryTable(args.client, args.query)
    else if (args.type === "nettyLog") res = await exportGen2NettyLog(args.client, args.query)
    else if (args.type === "statusNettyLog") res = await exportGen2StatusNettyLog(args.client, args.query)
    else if (args.type === "bluetoothCommandTasks") res = await exportGen2BluetoothCommandTasks(args.client, args.query)
    else if (args.type === "realtimeMsgLog") res = await exportGen2RealtimeMsgLog(args.client, args.query)
    else throw new Error(`[gen2] 不支持导出类型: ${args.type}`)
  } else {
    if (args.type === "batteryBase") res = await exportGen3BatteryBase(args.client, args.query)
    else if (args.type === "reportBatteryLog") res = await exportGen3ReportBatteryLog(args.client, args.query)
    else if (args.type === "cycle01MsgLog") res = await exportGen3Cycle01MsgLog(args.client, args.query)
    else if (args.type === "statusCommandLog") res = await exportGen3StatusCommandLog(args.client, args.query)
    else throw new Error(`[gen3] 不支持导出类型: ${args.type}`)
  }
  return { data: res.data, headers: res.headers, rowCount: await xlsxDataRowCount(res.data) }
}

async function xlsxDataRowCount(data: ArrayBuffer): Promise<number> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(data)
  const sheet = workbook.worksheets[0]
  return sheet ? Math.max(0, sheet.rowCount - 1) : 0
}

async function mergeApiWorkbooks(buffers: ArrayBuffer[], maxRows: number): Promise<ArrayBuffer> {
  const firstSource = new ExcelJS.Workbook()
  await firstSource.xlsx.load(buffers[0]!)
  const output = new ExcelJS.Workbook()
  const targetSheets = new Map<string, ExcelJS.Worksheet>()
  let remaining = maxRows
  for (const sourceSheet of firstSource.worksheets) {
    const targetSheet = createMergedSheet(output, sourceSheet)
    targetSheets.set(sourceSheet.name, targetSheet)
    const rowsToCopy = sourceSheet === firstSource.worksheets[0] ? Math.min(maxRows, Math.max(0, sourceSheet.rowCount - 1)) : Math.max(0, sourceSheet.rowCount - 1)
    copyDataRows(sourceSheet, targetSheet, rowsToCopy)
    if (sourceSheet === firstSource.worksheets[0]) remaining -= rowsToCopy
  }
  for (const buffer of buffers.slice(1)) {
    if (remaining <= 0) break
    const source = new ExcelJS.Workbook()
    await source.xlsx.load(buffer)
    const sourceSheet = source.worksheets[0]
    if (!sourceSheet) continue
    const targetSheet = targetSheets.get(sourceSheet.name) ?? createMergedSheet(output, sourceSheet)
    targetSheets.set(sourceSheet.name, targetSheet)
    const rowsToCopy = Math.min(remaining, Math.max(0, sourceSheet.rowCount - 1))
    copyDataRows(sourceSheet, targetSheet, rowsToCopy)
    remaining -= rowsToCopy
  }
  return output.xlsx.writeBuffer()
}

function createMergedSheet(workbook: ExcelJS.Workbook, source: ExcelJS.Worksheet): ExcelJS.Worksheet {
  const target = workbook.addWorksheet(source.name)
  target.columns = source.columns.map((column) => ({
    ...(column.header !== undefined ? { header: column.header } : {}),
    ...(column.key !== undefined ? { key: column.key } : {}),
    ...(column.width !== undefined ? { width: column.width } : {}),
  }))
  const sourceHeader = source.getRow(1)
  const targetHeader = target.getRow(1)
  targetHeader.values = sourceHeader.values
  sourceHeader.eachCell((cell, index) => {
    targetHeader.getCell(index).style = { ...cell.style }
  })
  return target
}

function copyDataRows(source: ExcelJS.Worksheet, target: ExcelJS.Worksheet, count: number): void {
  for (let rowNumber = 2; rowNumber <= count + 1; rowNumber++) {
    target.addRow(source.getRow(rowNumber).values as unknown[])
  }
}
