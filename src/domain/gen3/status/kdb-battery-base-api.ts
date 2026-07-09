import type { KdbSiteClient } from "../../../clients/kdb-site-client.js"
import type { TableDataInfo } from "../../../core/api/table-data.js"
import type { QueryObject } from "../../../core/http/http-client.js"

export type Gen3BatteryBaseRow = {
  batteryId?: string
  batteryStatus?: string
  faultStatus?: string
  chargeDischargeStatus?: string
  lte4gStatus?: string
  bluetoothStatus?: string
  [key: string]: unknown
}

export function listGen3BatteryBase(
  client: KdbSiteClient,
  query?: QueryObject,
): Promise<{ data: TableDataInfo<Gen3BatteryBaseRow>; status: number; headers: Headers }> {
  return client.request<TableDataInfo<Gen3BatteryBaseRow>>({
    path: "/managekdb/kdbBatteryBase/list",
    method: "GET",
    query,
    timeoutMs: 180000,
  })
}

export function exportGen3BatteryBase(
  client: KdbSiteClient,
  query?: QueryObject,
): Promise<{ data: ArrayBuffer; status: number; headers: Headers }> {
  return client.requestArrayBuffer({
    path: "/managekdb/kdbBatteryBase/export",
    method: "POST",
    query,
    timeoutMs: 180000,
  })
}
