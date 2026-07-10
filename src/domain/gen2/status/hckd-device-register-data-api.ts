import type { KdbSiteClient } from "../../../clients/kdb-site-client.js"
import type { TableDataInfo } from "../../../core/api/table-data.js"
import type { QueryObject } from "../../../core/http/http-client.js"

export type Gen2DeviceRegisterDataRow = {
  id?: number
  batteryId?: string
  registerStatus?: number | string
  createTime?: string
  updateTime?: string
  [key: string]: unknown
}

export function listGen2DeviceRegisterData(
  client: KdbSiteClient,
  query?: QueryObject,
): Promise<{ data: TableDataInfo<Gen2DeviceRegisterDataRow>; status: number; headers: Headers }> {
  return client.request<TableDataInfo<Gen2DeviceRegisterDataRow>>({
    path: "/hckd/hckdDeviceRegisterData/list",
    method: "GET",
    query,
  })
}
