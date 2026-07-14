import type { KdbSiteClient } from "../../../clients/kdb-site-client.js"
import type { AjaxResult } from "../../../core/api/ajax-result.js"
import type { TableDataInfo } from "../../../core/api/table-data.js"
import type { ParameterDefinition } from "../../parameters/parameter-types.js"

export type Gen3BluetoothParameterTask = {
  id?: number
  batteryId?: string
  operationType?: string
  parameterAddress?: string
  parameterAlias?: string
  parameterName?: string
  parameterContent?: string
  parameterMsgStatus?: string
  msgKey?: string
  msgLog?: string
  bluetoothCommandStatus?: string
  successfulExecutionTime?: string
  [key: string]: unknown
}

export const listGen3Parameters = (client: KdbSiteClient, query?: Record<string, unknown>) =>
  client.request<TableDataInfo<ParameterDefinition>>({ path: "/managekdb/kdbParameterBase/list", method: "GET", query: query as never })

export const sendGen3Command = (client: KdbSiteClient, channel: "4g" | "bluetooth", body: Record<string, unknown>) =>
  client.request<AjaxResult>({
    path: channel === "4g" ? "/managekdb/c/command/sendCommand" : "/managekdb/c/command/sendBluetoothCommand",
    method: "POST",
    body,
  })

export const getGen3CommandResult = (client: KdbSiteClient, body: Record<string, unknown>) =>
  client.request<AjaxResult>({ path: "/managekdb/c/command/getCommand", method: "POST", body, retryCount: 1 })

export const sendGen3OtaEnter = (client: KdbSiteClient, body: { batteryId: string; sessionId: number }) =>
  client.request<AjaxResult>({
    path: "/managekdb/c/command/sendCommand",
    method: "POST",
    body: { batteryId: body.batteryId, sessionId: body.sessionId, msgType: "60", msgSubType: "00", useMsg: "OTA升级" },
    retryCount: 0,
  })

export const readGen3Parameter = (client: KdbSiteClient, body: Record<string, unknown>) =>
  client.request<AjaxResult>({ path: "/managekdb/c/kdbParameterBase/readParameter", method: "POST", body })

export const readAllGen3Parameters = (client: KdbSiteClient, body: Record<string, unknown>) =>
  client.request<AjaxResult>({ path: "/managekdb/c/kdbParameterBase/readAllParameter", method: "POST", body })

export const getGen3ParameterResult = (client: KdbSiteClient, sessionId: number) =>
  client.request<TableDataInfo<ParameterDefinition>>({ path: "/managekdb/c/kdbParameterBase/getParameter", method: "POST", body: { sessionId } })

export const setGen3Parameter = (client: KdbSiteClient, body: Record<string, unknown>) =>
  client.request<AjaxResult>({ path: "/managekdb/c/kdbParameterBase/setParameter", method: "POST", body })

export const sendGen3BluetoothParameter = (client: KdbSiteClient, body: Record<string, unknown>) =>
  client.request<AjaxResult>({ path: "/managekdb/c/command/sendBluetoothParameter", method: "POST", body })

export const listGen3BluetoothParameterTasks = (client: KdbSiteClient, query?: Record<string, unknown>) =>
  client.request<TableDataInfo<Gen3BluetoothParameterTask>>({ path: "/managekdb/kdbBluetoothParameterTasks/list", method: "GET", query: query as never })
