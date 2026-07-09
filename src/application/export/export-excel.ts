import path from "path"
import type { KdbApiClients } from "../../index.js"
import type { RuntimeConfig } from "../../core/config/index.js"
import type { QueryObject } from "../../core/http/http-client.js"
import { getDefaultOutputDir, parseFilenameFromContentDisposition, saveArrayBuffer } from "../../core/export/download.js"
import { exportGen2BatteryBase } from "../../domain/gen2/status/hckd-battery-base-api.js"
import { exportGen2LatestBatteryTable } from "../../domain/gen2/status/hckd-battery-data-api.js"
import { exportGen2NettyLog } from "../../domain/gen2/logs/hckd-netty-log-api.js"
import { exportGen2StatusNettyLog } from "../../domain/gen2/logs/hckd-status-netty-log-api.js"
import { exportGen2BluetoothCommandTasks } from "../../domain/gen2/logs/hckd-bluetooth-command-tasks-api.js"
import { exportGen2RealtimeMsgLog } from "../../domain/gen2/logs/hckd-realtime-msg-log-api.js"
import { exportGen3BatteryBase } from "../../domain/gen3/status/kdb-battery-base-api.js"
import { exportGen3ReportBatteryLog } from "../../domain/gen3/logs/kdb-report-battery-log-api.js"
import { exportGen3Cycle01MsgLog } from "../../domain/gen3/logs/kdb-cycle01-msg-log-api.js"
import { exportGen3StatusCommandLog } from "../../domain/gen3/logs/kdb-status-command-log-api.js"

export type Generation = "gen2" | "gen3"

export type ExportType =
  | "batteryBase"
  | "latestBatteryTable"
  | "nettyLog"
  | "statusNettyLog"
  | "bluetoothCommandTasks"
  | "realtimeMsgLog"
  | "reportBatteryLog"
  | "cycle01MsgLog"
  | "statusCommandLog"

function nowCompact(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function defaultName(generation: Generation, type: ExportType): string {
  return `${generation}-${type}-${nowCompact()}.xlsx`
}

function getRuntimeConfigFromClients(clients: KdbApiClients): RuntimeConfig {
  return clients.config as unknown as RuntimeConfig
}

export async function exportExcel(args: {
  clients: KdbApiClients
  generation: Generation
  type: ExportType
  query?: QueryObject
  outputPath?: string
}): Promise<{ outputPath: string; filename?: string }> {
  const cfg = getRuntimeConfigFromClients(args.clients)
  const defaultDir = getDefaultOutputDir(cfg)

  const client = args.clients.getClient(args.generation)
  let res: { data: ArrayBuffer; status: number; headers: Headers }

  if (args.generation === "gen2") {
    if (args.type === "batteryBase") res = await exportGen2BatteryBase(client, args.query)
    else if (args.type === "latestBatteryTable") res = await exportGen2LatestBatteryTable(client, args.query ?? {})
    else if (args.type === "nettyLog") res = await exportGen2NettyLog(client, args.query)
    else if (args.type === "statusNettyLog") res = await exportGen2StatusNettyLog(client, args.query)
    else if (args.type === "bluetoothCommandTasks") res = await exportGen2BluetoothCommandTasks(client, args.query)
    else if (args.type === "realtimeMsgLog") res = await exportGen2RealtimeMsgLog(client, args.query)
    else throw new Error(`[gen2] 不支持导出类型: ${args.type}`)
  } else {
    if (args.type === "batteryBase") res = await exportGen3BatteryBase(client, args.query)
    else if (args.type === "reportBatteryLog") res = await exportGen3ReportBatteryLog(client, args.query)
    else if (args.type === "cycle01MsgLog") res = await exportGen3Cycle01MsgLog(client, args.query)
    else if (args.type === "statusCommandLog") res = await exportGen3StatusCommandLog(client, args.query)
    else throw new Error(`[gen3] 不支持导出类型: ${args.type}`)
  }

  const disposition = res.headers.get("content-disposition")
  const filename = parseFilenameFromContentDisposition(disposition)

  const finalOutputPath =
    args.outputPath?.trim() ||
    path.join(defaultDir, filename ?? defaultName(args.generation, args.type))

  await saveArrayBuffer({ outputPath: finalOutputPath, data: res.data })
  return filename ? { outputPath: finalOutputPath, filename } : { outputPath: finalOutputPath }
}
