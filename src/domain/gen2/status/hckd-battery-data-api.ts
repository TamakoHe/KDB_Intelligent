import type { KdbSiteClient } from "../../../clients/kdb-site-client.js"
import type { TableDataInfo } from "../../../core/api/table-data.js"
import type { QueryObject } from "../../../core/http/http-client.js"

export type Gen2LatestBatteryTableRow = {
  batteryId?: string
  logTime?: string
  residualElectricQuantity?: number
  dischargeAllNum?: number
  batteryStatus?: string
  gps?: string
  jwProvince?: string
  jwCity?: string
  jwArea?: string
  remark?: string
  [key: string]: unknown
}

export function listGen2LatestBatteryTable(
  client: KdbSiteClient,
  query?: QueryObject,
): Promise<{ data: TableDataInfo<Gen2LatestBatteryTableRow>; status: number; headers: Headers }> {
  return client.request<TableDataInfo<Gen2LatestBatteryTableRow>>({
    path: "/hckd/c/hckdBatteryData/listHckdBatteryList",
    method: "GET",
    query,
  })
}

export function exportGen2LatestBatteryTable(
  client: KdbSiteClient,
  query: QueryObject,
): Promise<{ data: ArrayBuffer; status: number; headers: Headers }> {
  return client.requestArrayBuffer({
    path: "/hckd/c/hckdBatteryData/batteryTableExport",
    method: "POST",
    query,
    timeoutMs: 180000,
  })
}
