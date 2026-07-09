import type { KdbSiteClient } from "../../../clients/kdb-site-client.js"
import type { TableDataInfo } from "../../../core/api/table-data.js"
import type { QueryObject } from "../../../core/http/http-client.js"

export type Gen2BatteryBaseRow = {
  batteryId?: string
  batteryStatus?: string
  lte4gStatus?: string
  lte4gTime?: string
  bluetoothStatus?: string
  bluetoothTime?: string
  [key: string]: unknown
}

export function listGen2BatteryBase(
  client: KdbSiteClient,
  query?: QueryObject,
): Promise<{ data: TableDataInfo<Gen2BatteryBaseRow>; status: number; headers: Headers }> {
  return client.request<TableDataInfo<Gen2BatteryBaseRow>>({
    path: "/hckd/hckdBatteryBase/list",
    method: "GET",
    query,
    timeoutMs: 180000,
  })
}

export function exportGen2BatteryBase(
  client: KdbSiteClient,
  query?: QueryObject,
): Promise<{ data: ArrayBuffer; status: number; headers: Headers }> {
  return client.requestArrayBuffer({
    path: "/hckd/hckdBatteryBase/export",
    method: "POST",
    query,
    timeoutMs: 180000,
  })
}
