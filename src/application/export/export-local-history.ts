import path from "node:path"
import fs from "node:fs/promises"
import ExcelJS from "exceljs"
import type { KdbApiClients } from "../../index.js"
import { getDefaultOutputDir, resolveOutputPath } from "../../core/export/download.js"
import type { ExportType } from "./export-excel.js"
import { createLocalHistoryRepository, type LocalGeneration, type LocalRow } from "../../domain/local/local-history-repository.js"
import { GEN2_BATTERY_BASE_FIELD_LABELS } from "../../domain/gen2/status/hckd-battery-base-api.js"
import { GEN3_BATTERY_BASE_FIELD_LABELS } from "../../domain/gen3/status/kdb-battery-base-api.js"

export type LocalExportResult = {
  outputPath: string
  rowCount: number
  source: "local"
}

type Column = { key: string; header: string }

const GEN3_REALTIME_COLUMNS: Column[] = [
  ["logTime", "数据时间"], ["networkType", "网络类型"], ["channelId", "通道ID"], ["msgHeader", "消息帧头"], ["msgId", "消息ID"], ["batteryId", "电池编码"], ["serialNumber", "产品系列号"], ["msgLength", "消息长度"], ["totalBatteryVoltage", "总电压"], ["externalVoltage", "外部总电压"], ["current", "总电流"], ["soc", "电池容量"], ["soh", "电池健康度"], ["dischargeAllNum", "循环次数"],
  ...Array.from({ length: 8 }, (_, index) => [`cellVoltage${index + 1}`, `单体电压${index + 1}`] as [string, string]),
  ...Array.from({ length: 4 }, (_, index) => [`cellTemperature${index + 1}`, `单体温度${index + 1}`] as [string, string]),
  ["dischargeMosTemperature", "放电MOS温度"], ["chargeMosTemperature", "充电MOS温度"], ["heatingFilmTemperature", "加热膜温度"], ["motherboardTemperature", "主板温度"], ["positivePoleTemperature", "正极柱温度"], ["negativePoleTemperature", "负极柱温度"], ["faultStatus", "故障状态"], ["chargeDischargeStatus", "充放电状态"], ["workingModeStatus", "运行模式"], ["systemOperatingStatus", "系统运行状态"], ["prechargedStatus", "预充状态"], ["strongStatus", "强起状态"], ["heatingStatus", "加热状态"], ["intelligentHeatingStatus", "智能加热状态"], ["chargingCurrentStatus", "充电限流状态"], ["chargingMosStatus", "充电MOS状态"], ["dischargeMosStatus", "放电MOS状态"], ["prechargeMosStatus", "预充MOS状态"], ["heatingMosStatus", "加热MOS状态"], ["vehicleOnGearStatus", "车辆ON档状态"], ["sparkNum", "打火次数"], ["maxSparkCurrent", "打火电流Max"], ["maxSparkHeat", "打火热量Max"], ["faultStatus1", "故障状态1"], ["faultStatus2", "故障状态2"], ["systemVersion", "系统软件版本"], ["longitude", "经度"], ["latitude", "纬度"], ["jwProvince", "经纬省"], ["jwCity", "经纬市"], ["jwArea", "经纬区"], ["jwVillage", "经纬镇"], ["p1Id", "一级代理id"], ["p2Id", "二级代理id"], ["p3Id", "三级代理id"], ["colorType", "颜色类型"], ["ip", "IP地址"], ["ipposition", "IP位置"], ["logMsg", "消息记录"], ["dataTableName", "数据表名"],
].map(([key, header]) => ({ key: key!, header: header! }))

const GEN2_REALTIME_COLUMNS: Column[] = [
  ["logTime", "数据时间"], ["msgHeader", "消息帧头"], ["msgId", "消息ID"], ["batteryDataId", "电池编码"], ["batteryId", "电池编号"], ["serialNumber", "产品系列号"], ["msgLength", "消息长度"],
  ...Array.from({ length: 8 }, (_, index) => [`cellVoltage${index + 1}`, `单体电压${index + 1}`] as [string, string]),
  ["cellTemperature", "单体温度"], ["boxTemperature", "箱体温度"], ["mosTemperature", "MOS温度"], ["ptcTemperature1", "PTC温度1"], ["ptcTemperature2", "PTC温度2"], ["totalBatteryVoltage", "总电压"], ["current", "总电流"], ["residualElectricQuantity", "剩余电量"], ["dischargeAllNum", "循环次数"], ["estimatedAvailableTime", "预计可用时间"], ["batteryStatus", "电池状态"], ["chargeMosStatus", "充电MOS状态"], ["dischargeMosStatus", "放电MOS状态"], ["forcedStatus", "强启状态"], ["prechargeStatus", "预充状态"], ["heatingStatus", "加热状态"], ["systemVersion", "系统软件版本"], ["maxStrikearcCurrent", "最大打火电流"], ["maxHeatAccum", "最大打火热量"], ["faultStatus", "故障状态"], ["longitude", "经度"], ["latitude", "纬度"], ["jwProvince", "经纬省"], ["jwCity", "经纬市"], ["jwArea", "经纬区"], ["jwVillage", "经纬镇"], ["p1Id", "一级代理id"], ["p2Id", "二级代理id"], ["p3Id", "三级代理id"], ["colorType", "颜色类型"], ["ip", "IP地址"], ["ipposition", "IP位置"],
].map(([key, header]) => ({ key: key!, header: header! }))

/**
 * The local exporter never exposes database snake_case columns directly.
 * Keys are the API camelCase names, in the same user-facing order as the
 * website's base-table export; realtime has its own exact registry above.
 */
export const LOCAL_EXPORT_FIELD_REGISTRY: Record<LocalGeneration, Partial<Record<ExportType, Column[]>>> = {
  gen2: {
    batteryBase: Object.entries(GEN2_BATTERY_BASE_FIELD_LABELS).map(([key, header]) => ({ key, header })),
    nettyLog: commonLogColumns(),
    statusNettyLog: commonLogColumns(),
    bluetoothCommandTasks: commonLogColumns(),
  },
  gen3: {
    batteryBase: Object.entries(GEN3_BATTERY_BASE_FIELD_LABELS).map(([key, header]) => ({ key, header })),
    reportBatteryLog: commonLogColumns(),
    statusCommandLog: commonLogColumns(),
  },
}

function commonLogColumns(): Column[] {
  return [
    ["id", "编号"], ["batteryId", "电池编号"], ["logTime", "日志时间"], ["createTime", "创建时间"], ["updateTime", "更新时间"],
    ["sessionId", "会话ID"], ["directionType", "消息方向"], ["msgId", "消息ID"], ["msgType", "消息类型"], ["msgKey", "消息Key"], ["msgStatus", "消息状态"], ["msgLog", "消息内容"], ["status", "状态"], ["remark", "备注"],
  ].map(([key, header]) => ({ key: key!, header: header! }))
}

function defaultName(generation: LocalGeneration, type: ExportType): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  return `${generation}-${type}-local-${stamp}.xlsx`
}

function columnsFor(generation: LocalGeneration, type: ExportType, rows: LocalRow[]): Column[] {
  if (type === "realtimeMsgLog" || type === "cycle01MsgLog" || type === "latestBatteryTable") {
    return generation === "gen3" ? GEN3_REALTIME_COLUMNS : GEN2_REALTIME_COLUMNS
  }
  const registered = LOCAL_EXPORT_FIELD_REGISTRY[generation][type]
  if (registered) return registered
  // This is intentionally an API-name fallback, never a raw SQL field name.
  // Add a table-specific registry entry before enabling another export type.
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))].sort()
  return keys.map((key) => ({ key, header: `字段：${key}` }))
}

function safeCell(value: unknown): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date || typeof value === "number" || typeof value === "boolean") return value
  const text = String(value)
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

async function writeWorkbook(args: { outputPath: string; generation: LocalGeneration; type: ExportType; rows: LocalRow[] }): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("电池详情数据")
  const columns = columnsFor(args.generation, args.type, args.rows)
  sheet.columns = columns.map((column) => ({ header: column.header, key: column.key, width: Math.min(Math.max(column.header.length + 2, 14), 24) }))
  for (const row of args.rows) {
    sheet.addRow(Object.fromEntries(columns.map((column) => [column.key, safeCell(row[column.key])])) )
  }
  const header = sheet.getRow(1)
  header.font = { bold: true }
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "D9EAF7" } }
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  sheet.autoFilter = { from: "A1", to: { row: 1, column: columns.length } }
  await fs.mkdir(path.dirname(args.outputPath), { recursive: true })
  await workbook.xlsx.writeFile(args.outputPath)
}

export async function exportLocalHistory(args: {
  clients: KdbApiClients
  generation: LocalGeneration
  type: ExportType
  batteryId?: string
  start?: string
  end?: string
  outputPath?: string
}): Promise<LocalExportResult> {
  const repository = createLocalHistoryRepository(args.clients.config)
  const rows = args.type === "realtimeMsgLog" || args.type === "cycle01MsgLog"
    ? await repository.listRealtime({ generation: args.generation, batteryId: args.batteryId ?? "", start: args.start ?? "0000-01-01 00:00:00", end: args.end ?? "9999-12-31 23:59:59" })
    : await repository.listExport(args)
  const outputPath = resolveOutputPath({ ...(args.outputPath ? { outputPath: args.outputPath } : {}), defaultDir: getDefaultOutputDir(args.clients.config), defaultName: defaultName(args.generation, args.type) })
  await writeWorkbook({ outputPath, generation: args.generation, type: args.type, rows })
  return { outputPath, rowCount: rows.length, source: "local" }
}
