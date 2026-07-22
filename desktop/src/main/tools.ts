import { randomUUID } from "node:crypto"
import { z } from "zod"
import type { AppSettings, DataSource, ResultCard } from "../shared.js"
import { getCore, getKdbClients } from "./kdb-core.js"

type PendingAction =
  | { kind: "command"; confirmationToken: string; args: Record<string, unknown> }
  | { kind: "parameter"; confirmationToken: string; args: Record<string, unknown> }
  | { kind: "ota"; confirmationToken: string; args: Record<string, unknown> }

const source = z.enum(["api", "local", "auto"]).optional()
const battery = z.object({ batteryId: z.string().trim().min(1), generation: z.enum(["gen2", "gen3"]).optional(), source })
const pendingActions = new Map<string, PendingAction>()

export const modelTools = [
  definition("get_battery_status", "查询一块电池的状态或本地历史快照。", battery),
  definition("get_battery_mode", "查询电池运行模式；本地来源返回历史快照。", battery),
  definition("export_realtime", "导出指定时间范围内的实时数据 Excel。", battery.extend({ start: z.string().optional(), end: z.string().optional(), hours: z.number().positive().optional(), outputPath: z.string().optional() })),
  definition("list_parameters", "查询参数定义，可按关键字筛选；这不是读取电池当前参数值。", battery.extend({ search: z.string().optional() })),
  definition("ota_version", "查询电池当前固件版本。", battery),
  definition("list_firmwares", "查询适用于电池代际的固件列表。", battery.extend({ firmwareVersion: z.string().optional(), firmwareName: z.string().optional() })),
  definition("preview_command", "预览一条电池控制命令，不会执行。", battery.extend({ command: z.string().min(1), channel: z.enum(["4g", "bluetooth"]).default("4g"), value: z.string().optional() })),
  definition("preview_parameter_write", "预览参数写入，不会执行。", battery.extend({ selector: z.string().min(1), value: z.string(), channel: z.enum(["4g", "bluetooth"]).default("4g"), currentValue: z.string().optional() })),
  definition("preview_ota_start", "预览单电池 OTA 启动，不会执行。", battery.extend({ firmwareId: z.string().optional(), firmwareVersion: z.string().optional(), firmwareName: z.string().optional(), allowDowngrade: z.boolean().optional() })),
]

export async function executeTool(name: string, rawArgs: unknown, settings: AppSettings): Promise<{ model: unknown; card?: ResultCard }> {
  const parsed = schemaFor(name).safeParse(rawArgs)
  if (!parsed.success) return { model: { ok: false, error: `工具参数无效: ${parsed.error.issues.map((item) => item.message).join("；")}` }, card: errorCard("参数无效", "模型提供的工具参数未通过本地校验。") }
  const args = parsed.data as Record<string, unknown>
  const core = await getCore()
  const clients = await getKdbClients(settings)

  try {
    if (name === "get_battery_status") {
      const result = await core.queryBatteryStatusById({ clients, ...args })
      return { model: result, card: statusCard(result) }
    }
    if (name === "get_battery_mode") {
      const result = await core.queryBatteryStatusById({ clients, ...args })
      const summary = result.summary ?? {}
      return { model: result, card: { id: randomUUID(), kind: "status", title: "电池运行模式", summary: `${result.batteryId}：${summary.workingModeText ?? "未上报"}`, data: result } }
    }
    if (name === "export_realtime") {
      const result = await core.exportBatteryRealtimeData({ clients, ...args })
      return { model: result, card: { id: randomUUID(), kind: "export", title: "实时数据已导出", summary: `${result.rowCount ?? "未知"} 条记录 · ${result.source}`, data: result } }
    }
    if (name === "list_parameters") {
      const result = await core.listBatteryParameters({ clients, ...args })
      return { model: result, card: { id: randomUUID(), kind: "data", title: "参数定义", summary: `共 ${result.total} 项 · ${result.source}`, data: result } }
    }
    if (name === "ota_version") {
      const result = await core.queryOtaVersion({ clients, ...args })
      return { model: result, card: { id: randomUUID(), kind: "data", title: "当前固件版本", summary: result.currentVersion ?? "未找到版本", data: result } }
    }
    if (name === "list_firmwares") {
      const result = await core.listOtaFirmware({ clients, ...args })
      return { model: result, card: { id: randomUUID(), kind: "data", title: "固件列表", summary: `共 ${result.total} 条 · ${result.source}`, data: result } }
    }
    if (name === "preview_command") return previewCommand(core, clients, args)
    if (name === "preview_parameter_write") return previewParameter(core, clients, args)
    if (name === "preview_ota_start") return previewOta(core, clients, args)
    return { model: { ok: false, error: `未实现工具 ${name}` } }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { model: { ok: false, error: message }, card: errorCard("KDB 操作失败", message) }
  }
}

export async function confirmAction(actionId: string, settings: AppSettings): Promise<ResultCard> {
  const action = pendingActions.get(actionId)
  if (!action) return errorCard("操作已失效", "未找到该预览操作；请重新发起请求。")
  const core = await getCore()
  const clients = await getKdbClients(settings)
  try {
    const result = action.kind === "command"
      ? await core.controlBatteryCommand({ clients, ...action.args, confirmationToken: action.confirmationToken })
      : action.kind === "parameter"
        ? await core.writeBatteryParameter({ clients, ...action.args, confirmationToken: action.confirmationToken })
        : await core.startOtaUpgrade({ clients, ...action.args, confirmationToken: action.confirmationToken })
    pendingActions.delete(actionId)
    return { id: randomUUID(), kind: "success", title: "操作已提交", summary: "后台已接受本次确认操作；请继续查询状态或回执验证设备效果。", data: result }
  } catch (error) {
    return errorCard("确认操作失败", error instanceof Error ? error.message : String(error))
  }
}

export function cancelAction(actionId: string): void {
  pendingActions.delete(actionId)
}

function definition(name: string, description: string, schema: z.ZodType): Record<string, unknown> {
  return { type: "function", function: { name, description, parameters: z.toJSONSchema(schema), strict: false } }
}

function schemaFor(name: string): z.ZodType {
  const common = battery
  const schemas: Record<string, z.ZodType> = {
    get_battery_status: common,
    get_battery_mode: common,
    export_realtime: common.extend({ start: z.string().optional(), end: z.string().optional(), hours: z.number().positive().optional(), outputPath: z.string().optional() }),
    list_parameters: common.extend({ search: z.string().optional() }),
    ota_version: common,
    list_firmwares: common.extend({ firmwareVersion: z.string().optional(), firmwareName: z.string().optional() }),
    preview_command: common.extend({ command: z.string().min(1), channel: z.enum(["4g", "bluetooth"]).default("4g"), value: z.string().optional() }),
    preview_parameter_write: common.extend({ selector: z.string().min(1), value: z.string(), channel: z.enum(["4g", "bluetooth"]).default("4g"), currentValue: z.string().optional() }),
    preview_ota_start: common.extend({ firmwareId: z.string().optional(), firmwareVersion: z.string().optional(), firmwareName: z.string().optional(), allowDowngrade: z.boolean().optional() }),
  }
  return schemas[name] ?? z.never()
}

async function previewCommand(core: any, clients: any, args: Record<string, unknown>) {
  const result = await core.controlBatteryCommand({ clients, ...args })
  return previewResult("command", result, args, "命令预览", "确认后向后台提交控制命令。")
}

async function previewParameter(core: any, clients: any, args: Record<string, unknown>) {
  const result = await core.writeBatteryParameter({ clients, ...args })
  return previewResult("parameter", result, args, "参数写入预览", "确认后写入参数；请核对旧值和新值。")
}

async function previewOta(core: any, clients: any, args: Record<string, unknown>) {
  const result = await core.startOtaUpgrade({ clients, ...args })
  return previewResult("ota", result, args, "OTA 启动预览", "确认后会修改推送状态并发起 OTA。")
}

function previewResult(kind: PendingAction["kind"], result: any, args: Record<string, unknown>, title: string, summary: string) {
  if (!result.confirmationToken) return { model: result, card: { id: randomUUID(), kind: "data" as const, title, summary: result.message ?? "操作未产生可确认预览。", data: result } }
  const actionId = randomUUID()
  pendingActions.set(actionId, { kind, confirmationToken: result.confirmationToken, args })
  return { model: { ...result, confirmationToken: "[已由桌面端保管]", actionId }, card: { id: randomUUID(), kind: "preview" as const, title, summary, data: result, actionId, actionLabel: "确认执行" } }
}

function statusCard(result: any): ResultCard {
  const source = result.source ?? "api"
  const historical = result.isHistorical ? ` · 历史快照 ${result.asOf ?? ""}` : ""
  return { id: randomUUID(), kind: "status", title: "电池状态", summary: `${result.batteryId} · ${result.found ? "已找到" : "未找到"} · ${source}${historical}`, data: result }
}

function errorCard(title: string, summary: string): ResultCard {
  return { id: randomUUID(), kind: "error", title, summary }
}
