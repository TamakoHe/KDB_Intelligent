import type { KdbSiteClient } from "../../../clients/kdb-site-client.js"
import type { TableDataInfo } from "../../../core/api/table-data.js"
import type { QueryObject } from "../../../core/http/http-client.js"

export type Gen2StatusNettyLogRow = {
  id?: number
  batteryId?: string
  logTime?: string
  createTime?: string
  directionType?: string
  msgType?: number
  msgStatus?: number
  msgKey?: string
  msgId?: string
  msgLog?: string
  [key: string]: unknown
}

export function listGen2StatusNettyLog(
  client: KdbSiteClient,
  query?: QueryObject,
): Promise<{ data: TableDataInfo<Gen2StatusNettyLogRow>; status: number; headers: Headers }> {
  return client.request<TableDataInfo<Gen2StatusNettyLogRow>>({
    path: "/hckd/hckdStatusNettyLog/list",
    method: "GET",
    query,
  })
}

export function exportGen2StatusNettyLog(
  client: KdbSiteClient,
  query?: QueryObject,
): Promise<{ data: ArrayBuffer; status: number; headers: Headers }> {
  return client.requestArrayBuffer({
    path: "/hckd/hckdStatusNettyLog/export",
    method: "POST",
    query,
    timeoutMs: 180000,
  })
}
