import type { KdbSiteClient } from "../../../clients/kdb-site-client.js"
import type { TableDataInfo } from "../../../core/api/table-data.js"
import type { QueryObject } from "../../../core/http/http-client.js"

export type Gen2BluetoothCommandTasksRow = {
  id?: number
  batteryId?: string
  [key: string]: unknown
}

export function listGen2BluetoothCommandTasks(
  client: KdbSiteClient,
  query?: QueryObject,
): Promise<{ data: TableDataInfo<Gen2BluetoothCommandTasksRow>; status: number; headers: Headers }> {
  return client.request<TableDataInfo<Gen2BluetoothCommandTasksRow>>({
    path: "/hckd/hckdBluetoothCommandTasks/list",
    method: "GET",
    query,
  })
}

export function exportGen2BluetoothCommandTasks(
  client: KdbSiteClient,
  query?: QueryObject,
): Promise<{ data: ArrayBuffer; status: number; headers: Headers }> {
  return client.requestArrayBuffer({
    path: "/hckd/hckdBluetoothCommandTasks/export",
    method: "POST",
    query,
    timeoutMs: 180000,
  })
}
