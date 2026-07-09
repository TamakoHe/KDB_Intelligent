import type { KdbSiteClient } from "../../../clients/kdb-site-client.js"
import type { TableDataInfo } from "../../../core/api/table-data.js"
import type { QueryObject } from "../../../core/http/http-client.js"

export type Gen3Cycle01MsgLogRow = {
  id?: number
  batteryId?: string
  logTime?: string
  [key: string]: unknown
}

export function listGen3Cycle01MsgLog(
  client: KdbSiteClient,
  query?: QueryObject,
): Promise<{ data: TableDataInfo<Gen3Cycle01MsgLogRow>; status: number; headers: Headers }> {
  return client.request<TableDataInfo<Gen3Cycle01MsgLogRow>>({
    path: "/managekdb/kdbCycle01MsgLog/list",
    method: "GET",
    query,
  })
}

export function exportGen3Cycle01MsgLog(
  client: KdbSiteClient,
  query?: QueryObject,
): Promise<{ data: ArrayBuffer; status: number; headers: Headers }> {
  return client.requestArrayBuffer({
    path: "/managekdb/kdbCycle01MsgLog/export",
    method: "POST",
    query,
    timeoutMs: 180000,
  })
}
