import type { KdbSiteClient } from "../../../clients/kdb-site-client.js"
import type { TableDataInfo } from "../../../core/api/table-data.js"
import type { QueryObject } from "../../../core/http/http-client.js"

export type Gen3ReportBatteryLogRow = {
  id?: number
  batteryId?: string
  logTime?: string
  [key: string]: unknown
}

export function listGen3ReportBatteryLog(
  client: KdbSiteClient,
  query?: QueryObject,
): Promise<{ data: TableDataInfo<Gen3ReportBatteryLogRow>; status: number; headers: Headers }> {
  return client.request<TableDataInfo<Gen3ReportBatteryLogRow>>({
    path: "/managekdb/kdbReportBatteryLog/list",
    method: "GET",
    query,
  })
}

export function exportGen3ReportBatteryLog(
  client: KdbSiteClient,
  query?: QueryObject,
): Promise<{ data: ArrayBuffer; status: number; headers: Headers }> {
  return client.requestArrayBuffer({
    path: "/managekdb/kdbReportBatteryLog/export",
    method: "POST",
    query,
    timeoutMs: 180000,
  })
}
