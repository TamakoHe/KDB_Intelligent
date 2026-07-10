import type { KdbSiteClient } from "../../../clients/kdb-site-client.js"
import type { TableDataInfo } from "../../../core/api/table-data.js"
import type { QueryObject } from "../../../core/http/http-client.js"

export type Gen3DeviceRegisterDataRow = {
  id?: number
  batteryId?: string
  registerStatus?: number | string
  createTime?: string
  updateTime?: string
  [key: string]: unknown
}

export function listGen3DeviceRegisterData(
  client: KdbSiteClient,
  query?: QueryObject,
): Promise<{ data: TableDataInfo<Gen3DeviceRegisterDataRow>; status: number; headers: Headers }> {
  return client.request<TableDataInfo<Gen3DeviceRegisterDataRow>>({
    path: "/managekdb/kdbDeviceRegisterData/list",
    method: "GET",
    query,
  })
}
