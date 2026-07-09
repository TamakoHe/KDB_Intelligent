import type { KdbSiteClient } from "../../../clients/kdb-site-client.js"
import type { TableDataInfo } from "../../../core/api/table-data.js"
import type { QueryObject } from "../../../core/http/http-client.js"

export type Gen2RealtimeMsgLogRow = {
  id?: number
  batteryId?: string
  logTime?: string
  totalBatteryVoltage?: number
  current?: number
  residualElectricQuantity?: number
  longitude?: number
  latitude?: number
  [key: string]: unknown
}

export function listGen2RealtimeMsgLog(
  client: KdbSiteClient,
  query?: QueryObject,
): Promise<{ data: TableDataInfo<Gen2RealtimeMsgLogRow>; status: number; headers: Headers }> {
  const request = {
    path: "/hckd/hckdLiheMsgLog/list",
    method: "GET",
  } as const
  return query
    ? client.request<TableDataInfo<Gen2RealtimeMsgLogRow>>({ ...request, query })
    : client.request<TableDataInfo<Gen2RealtimeMsgLogRow>>(request)
}

export function exportGen2RealtimeMsgLog(
  client: KdbSiteClient,
  query?: QueryObject,
): Promise<{ data: ArrayBuffer; status: number; headers: Headers }> {
  const request = {
    path: "/hckd/hckdLiheMsgLog/export",
    method: "POST",
    timeoutMs: 180000,
  } as const
  return query ? client.requestArrayBuffer({ ...request, query }) : client.requestArrayBuffer(request)
}
