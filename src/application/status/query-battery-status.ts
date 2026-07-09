import type { KdbApiClients } from "../../index.js"
import { assertTableOk, type TableDataInfo } from "../../core/api/table-data.js"
import type { QueryObject } from "../../core/http/http-client.js"
import { listGen2BatteryBase } from "../../domain/gen2/status/hckd-battery-base-api.js"
import { listGen2LatestBatteryTable } from "../../domain/gen2/status/hckd-battery-data-api.js"
import { listGen3BatteryBase } from "../../domain/gen3/status/kdb-battery-base-api.js"
import { listGen3ReportBatteryLog } from "../../domain/gen3/logs/kdb-report-battery-log-api.js"

export type Generation = "gen2" | "gen3"

export type UnifiedBatteryStatus = {
  generation: Generation
  batteryId?: string
  batteryStatus?: string
  faultStatus?: string
  chargeDischargeStatus?: string
  networkStatus?: string
  networkTime?: string
  bluetoothStatus?: string
  bluetoothTime?: string
  logTime?: string
  raw?: Record<string, unknown>
}

function toArray<T>(rows: T[] | undefined): T[] {
  return Array.isArray(rows) ? rows : []
}

function mapGen2BatteryBaseRow(row: Record<string, unknown>): UnifiedBatteryStatus {
  return {
    generation: "gen2",
    batteryId: typeof row.batteryId === "string" ? row.batteryId : undefined,
    batteryStatus: typeof row.batteryStatus === "string" ? row.batteryStatus : undefined,
    networkStatus: typeof row.lte4gStatus === "string" ? row.lte4gStatus : undefined,
    networkTime: typeof row.lte4gTime === "string" ? row.lte4gTime : undefined,
    bluetoothStatus: typeof row.bluetoothStatus === "string" ? row.bluetoothStatus : undefined,
    bluetoothTime: typeof row.bluetoothTime === "string" ? row.bluetoothTime : undefined,
    raw: row,
  }
}

function mapGen3BatteryBaseRow(row: Record<string, unknown>): UnifiedBatteryStatus {
  return {
    generation: "gen3",
    batteryId: typeof row.batteryId === "string" ? row.batteryId : undefined,
    batteryStatus: typeof row.batteryStatus === "string" ? row.batteryStatus : undefined,
    faultStatus: typeof row.faultStatus === "string" ? row.faultStatus : undefined,
    chargeDischargeStatus:
      typeof row.chargeDischargeStatus === "string" ? row.chargeDischargeStatus : undefined,
    networkStatus: typeof row.lte4gStatus === "string" ? row.lte4gStatus : undefined,
    bluetoothStatus: typeof row.bluetoothStatus === "string" ? row.bluetoothStatus : undefined,
    raw: row,
  }
}

function mapGen2LatestTableRow(row: Record<string, unknown>): UnifiedBatteryStatus {
  return {
    generation: "gen2",
    batteryId: typeof row.batteryId === "string" ? row.batteryId : undefined,
    batteryStatus: typeof row.batteryStatus === "string" ? row.batteryStatus : undefined,
    logTime: typeof row.logTime === "string" ? row.logTime : undefined,
    raw: row,
  }
}

function mapGen3ReportBatteryLogRow(row: Record<string, unknown>): UnifiedBatteryStatus {
  return {
    generation: "gen3",
    batteryId: typeof row.batteryId === "string" ? row.batteryId : undefined,
    logTime: typeof row.logTime === "string" ? row.logTime : undefined,
    raw: row,
  }
}

export async function queryBatteryBaseStatus(args: {
  clients: KdbApiClients
  generation: Generation
  query?: QueryObject
}): Promise<{ total: number; rows: UnifiedBatteryStatus[]; raw: TableDataInfo }> {
  if (args.generation === "gen2") {
    const res = await listGen2BatteryBase(args.clients.gen2, args.query)
    assertTableOk({ generation: "gen2", action: "listBatteryBase", result: res.data })
    const rows = toArray(res.data.rows).map((r) => mapGen2BatteryBaseRow(r as any))
    return { total: Number(res.data.total ?? rows.length), rows, raw: res.data }
  }

  const res = await listGen3BatteryBase(args.clients.gen3, args.query)
  assertTableOk({ generation: "gen3", action: "listBatteryBase", result: res.data })
  const rows = toArray(res.data.rows).map((r) => mapGen3BatteryBaseRow(r as any))
  return { total: Number(res.data.total ?? rows.length), rows, raw: res.data }
}

export async function queryLatestReportStatus(args: {
  clients: KdbApiClients
  generation: Generation
  query?: QueryObject
}): Promise<{ total: number; rows: UnifiedBatteryStatus[]; raw: TableDataInfo }> {
  if (args.generation === "gen2") {
    const res = await listGen2LatestBatteryTable(args.clients.gen2, args.query)
    assertTableOk({ generation: "gen2", action: "listLatestBatteryTable", result: res.data })
    const rows = toArray(res.data.rows).map((r) => mapGen2LatestTableRow(r as any))
    return { total: Number(res.data.total ?? rows.length), rows, raw: res.data }
  }

  const res = await listGen3ReportBatteryLog(args.clients.gen3, args.query)
  assertTableOk({ generation: "gen3", action: "listReportBatteryLog", result: res.data })
  const rows = toArray(res.data.rows).map((r) => mapGen3ReportBatteryLogRow(r as any))
  return { total: Number(res.data.total ?? rows.length), rows, raw: res.data }
}

export async function queryBatteryStatus(args: {
  clients: KdbApiClients
  generation: Generation
  baseQuery?: QueryObject
  latestQuery?: QueryObject
}): Promise<{
  base: { total: number; rows: UnifiedBatteryStatus[] }
  latest: { total: number; rows: UnifiedBatteryStatus[] }
}> {
  const [base, latest] = await Promise.all([
    queryBatteryBaseStatus({ clients: args.clients, generation: args.generation, query: args.baseQuery }),
    queryLatestReportStatus({
      clients: args.clients,
      generation: args.generation,
      query: args.latestQuery,
    }),
  ])
  return { base: { total: base.total, rows: base.rows }, latest: { total: latest.total, rows: latest.rows } }
}

