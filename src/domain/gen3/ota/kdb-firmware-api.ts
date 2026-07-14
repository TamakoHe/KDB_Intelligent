import type { KdbSiteClient } from "../../../clients/kdb-site-client.js"
import type { AjaxResult } from "../../../core/api/ajax-result.js"
import type { TableDataInfo } from "../../../core/api/table-data.js"
import type { FirmwareDefinition } from "../../ota/ota-types.js"

export const listGen3Firmwares = (client: KdbSiteClient, query?: Record<string, unknown>) =>
  client.request<TableDataInfo<FirmwareDefinition>>({
    path: "/managekdb/kdbFirmwareBase/list",
    method: "GET",
    query: query as never,
  })

export const getGen3Firmware = (client: KdbSiteClient, id: string | number) =>
  client.request<AjaxResult<FirmwareDefinition>>({
    path: `/managekdb/kdbFirmwareBase/${encodeURIComponent(String(id))}`,
    method: "GET",
  })

export const updateGen3Firmware = (client: KdbSiteClient, firmware: FirmwareDefinition) =>
  client.request<AjaxResult>({
    path: "/managekdb/kdbFirmwareBase",
    method: "PUT",
    body: firmware,
  })
