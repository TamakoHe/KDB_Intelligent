import type { KdbSiteClient } from "../../../clients/kdb-site-client.js"
import type { AjaxResult } from "../../../core/api/ajax-result.js"
import type { TableDataInfo } from "../../../core/api/table-data.js"
import type { FirmwareDefinition } from "../../ota/ota-types.js"

export const listGen2Firmwares = (client: KdbSiteClient, query?: Record<string, unknown>) =>
  client.request<TableDataInfo<FirmwareDefinition>>({
    path: "/hckd/hckdFirmwareBase/list",
    method: "GET",
    query: query as never,
  })

export const getGen2Firmware = (client: KdbSiteClient, id: string | number) =>
  client.request<AjaxResult<FirmwareDefinition>>({
    path: `/hckd/hckdFirmwareBase/${encodeURIComponent(String(id))}`,
    method: "GET",
  })

/** The verified Gen2 web flow uses the legacy GET endpoint with msgType=4. */
export const sendGen2OtaCommand = (client: KdbSiteClient, body: { batteryId: string }) =>
  client.request<AjaxResult>({
    path: "/front/bl/sendbms",
    method: "GET",
    query: { batteryId: body.batteryId, msgType: "4" },
    retryCount: 0,
  })

export const getGen2BatteryVersion = (client: KdbSiteClient, batteryId: string) =>
  client.request<AjaxResult<Record<string, unknown>>>({
    path: "/front/bl/batteryVersion",
    method: "POST",
    body: { batteryId },
  })

export const updateGen2Firmware = (client: KdbSiteClient, firmware: FirmwareDefinition) =>
  client.request<AjaxResult>({
    path: "/hckd/hckdFirmwareBase",
    method: "PUT",
    body: firmware,
  })
