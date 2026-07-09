import type { KdbSiteClient } from "../../../clients/kdb-site-client.js"
import type { TableDataInfo } from "../../../core/api/table-data.js"
import type { QueryObject } from "../../../core/http/http-client.js"

export type Gen2NettyLogRow = {
  id?: number
  batteryId?: string
  logTime?: string
  [key: string]: unknown
}

export function listGen2NettyLog(
  client: KdbSiteClient,
  query?: QueryObject,
): Promise<{ data: TableDataInfo<Gen2NettyLogRow>; status: number; headers: Headers }> {
  return client.request<TableDataInfo<Gen2NettyLogRow>>({
    path: "/hckd/hckdNettyLog/list",
    method: "GET",
    query,
  })
}

export function exportGen2NettyLog(
  client: KdbSiteClient,
  query?: QueryObject,
): Promise<{ data: ArrayBuffer; status: number; headers: Headers }> {
  return client.requestArrayBuffer({
    path: "/hckd/hckdNettyLog/export",
    method: "POST",
    query,
    timeoutMs: 180000,
  })
}
