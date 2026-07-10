import type { KdbSiteClient } from "../../../clients/kdb-site-client.js"
import type { AjaxResult } from "../../../core/api/ajax-result.js"
import type { TableDataInfo } from "../../../core/api/table-data.js"
import type { ParameterDefinition } from "../../parameters/parameter-types.js"

export type Gen2BluetoothTask = {
  id?: number
  batteryId?: string
  msgId?: string
  msgType?: string
  msgKey?: string
  msgLog?: string
  executeNum?: number
  bluetoothCommandStatus?: string
  [key: string]: unknown
}

export const listGen2Parameters = (client: KdbSiteClient, query?: Record<string, unknown>) =>
  client.request<TableDataInfo<ParameterDefinition>>({ path: "/hckd/hckdParameterBase/list", method: "GET", query: query as never })

export const sendGen2FourGCommand = (client: KdbSiteClient, body: { batteryId: string; msgType: string; time?: string }) =>
  client.request<AjaxResult>({
    path: Number(body.msgType) >= 10 ? "/front/bl/sendnewbms" : "/front/bl/sendbms",
    method: "GET",
    query: body,
    retryCount: 0,
  })

export const sendGen2BluetoothCommand = (client: KdbSiteClient, body: Record<string, unknown>) =>
  client.request<AjaxResult>({ path: "/hckd/c/hckdBatteryBase/sendBluetoothCommand", method: "POST", body })

export const addGen2BluetoothTask = (client: KdbSiteClient, body: Gen2BluetoothTask) =>
  client.request<AjaxResult>({ path: "/hckd/hckdBluetoothCommandTasks", method: "POST", body })

export const listGen2BluetoothTasks = (client: KdbSiteClient, query?: Record<string, unknown>) =>
  client.request<TableDataInfo<Gen2BluetoothTask>>({ path: "/hckd/hckdBluetoothCommandTasks/list", method: "GET", query: query as never })

export const readGen2Parameter = (client: KdbSiteClient, body: Record<string, unknown>) =>
  client.request<AjaxResult>({ path: "/hckd/hckdParameterBase/readParameter", method: "POST", body })

export const readAllGen2Parameters = (client: KdbSiteClient, body: Record<string, unknown>) =>
  client.request<AjaxResult>({ path: "/hckd/hckdParameterBase/readAllParameter", method: "POST", body })

export const getGen2ParameterResult = (client: KdbSiteClient, sessionId: number) =>
  client.request<TableDataInfo<ParameterDefinition>>({ path: "/hckd/hckdParameterBase/getParameter", method: "POST", body: { sessionId } })

export const queueGen2ParameterWrite = (client: KdbSiteClient, body: Record<string, unknown>) =>
  client.request<AjaxResult>({ path: "/hckd/hckdParameterBase/simplifyParameter", method: "POST", body })
