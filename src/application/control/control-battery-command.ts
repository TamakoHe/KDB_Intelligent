import { randomInt } from "node:crypto"
import type { KdbApiClients } from "../../index.js"
import { assertAjaxOk } from "../../core/api/ajax-result.js"
import { createConfirmationToken, verifyConfirmationToken, type ConfirmationAction } from "../../core/control/confirmation.js"
import { resolveGeneration } from "../../core/config/index.js"
import { listBatteryCommands, resolveBatteryCommand, type ControlChannel } from "../../domain/control/command-catalog.js"
import { sendGen2BluetoothCommand, sendGen2FourGCommand } from "../../domain/gen2/control/hckd-control-api.js"
import { getGen3CommandResult, sendGen3Command } from "../../domain/gen3/control/kdb-control-api.js"
import { listGen2StatusNettyLog } from "../../domain/gen2/logs/hckd-status-netty-log-api.js"
import { assertTableOk } from "../../core/api/table-data.js"
import { queryBatteryCommandReadiness } from "../status/query-command-readiness.js"

export function normalizedBattery(clients: KdbApiClients, batteryId: string, generation?: "gen2" | "gen3") {
  const normalized = batteryId.trim().toUpperCase()
  const inferred = resolveGeneration(normalized, clients.config)
  if (generation && generation !== inferred) throw new Error(`指定代际 ${generation} 与电池编号推断结果 ${inferred} 不一致`)
  return { batteryId: normalized, generation: generation ?? inferred }
}

export function getBatteryCommandCatalog(args: {
  clients: KdbApiClients
  batteryId: string
  generation?: "gen2" | "gen3"
  channel?: ControlChannel
}) {
  const target = normalizedBattery(args.clients, args.batteryId, args.generation)
  return {
    ...target,
    channel: args.channel ?? null,
    commands: listBatteryCommands(target.generation, args.channel).map((command) => ({
      ...command,
      chineseName: command.label,
      naturalLanguageAliases: command.aliases,
      risk: command.description,
    })),
  }
}

export async function controlBatteryCommand(args: {
  clients: KdbApiClients
  batteryId: string
  generation?: "gen2" | "gen3"
  channel: ControlChannel
  command: string
  value?: string
  confirmationToken?: string
}) {
  const target = normalizedBattery(args.clients, args.batteryId, args.generation)
  const command = resolveBatteryCommand(target.generation, args.channel, args.command)
  if (command.value?.required && !args.value) throw new Error(`命令 ${command.name} 需要 --value <${command.value.name}>`)
  if (!command.value && args.value !== undefined) throw new Error(`命令 ${command.name} 不接受 --value`)
  if (command.name === "upload-interval") {
    const seconds = Number(args.value)
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 655) throw new Error("上报间隔必须是 1~655 的整数秒")
  }

  const action: ConfirmationAction = {
    kind: "command",
    generation: target.generation,
    channel: args.channel,
    batteryId: target.batteryId,
    operation: command.name,
    payload: { ...(args.value !== undefined ? { value: args.value } : {}) },
  }
  if (!args.confirmationToken) {
    const readiness = args.channel === "4g"
      ? await queryBatteryCommandReadiness({ clients: args.clients, ...target })
      : undefined
    return {
      phase: "preview" as const,
      action,
      command,
      ...(readiness ? { readiness } : {}),
      ...createConfirmationToken(action, args.clients.config),
      next: "确认内容无误后，使用完全相同的参数并添加 --confirm <confirmationToken>",
    }
  }
  verifyConfirmationToken(action, args.confirmationToken, args.clients.config)
  if (args.channel === "4g" && command.name !== "wechat-log-toggle") {
    const readiness = await queryBatteryCommandReadiness({ clients: args.clients, ...target })
    if (!readiness.canSendCommand) throw new Error(`当前不可通过 4G 下发: ${readiness.reason}`)
  }
  return executeBatteryCommand({ clients: args.clients, ...target, channel: args.channel, command, ...(args.value !== undefined ? { value: args.value } : {}) })
}

/** Executes a pre-validated command. Kept separate for the batch workflow after its shared confirmation gate. */
export async function executeBatteryCommand(args: {
  clients: KdbApiClients
  batteryId: string
  generation: "gen2" | "gen3"
  channel: ControlChannel
  command: ReturnType<typeof resolveBatteryCommand>
  value?: string
}) {
  const sessionId = randomInt(1, 0x7fffffff)
  if (args.generation === "gen2") {
    const response = args.channel === "4g"
      ? await sendGen2FourGCommand(args.clients.gen2, {
          batteryId: args.batteryId,
          msgType: args.command.gen2!.fourGMsgType!,
          ...(args.value !== undefined ? { time: args.value } : {}),
        })
      : await sendGen2BluetoothCommand(args.clients.gen2, {
          batteryId: args.batteryId,
          sessionId,
          operateType: args.command.gen2!.bluetoothOperateType!,
        })
    assertAjaxOk({ generation: "gen2", action: `command:${args.command.name}`, result: response.data })
  } else {
    const response = await sendGen3Command(args.clients.gen3, args.channel, {
      batteryId: args.batteryId,
      sessionId,
      msgType: args.command.gen3!.msgType,
      msgSubType: args.command.gen3!.msgSubType,
      useMsg: args.command.label,
    })
    assertAjaxOk({ generation: "gen3", action: `command:${args.command.name}`, result: response.data })
  }
  return {
    phase: "submitted" as const,
    batteryId: args.batteryId,
    generation: args.generation,
    channel: args.channel,
    command: args.command.name,
    sessionId,
    status: args.channel === "bluetooth" ? "QUEUED_FOR_APP" : "SENT",
    applied: false,
    message: args.channel === "bluetooth"
      ? "命令已进入网站蓝牙任务队列，需手机 App 连接该电池后执行"
      : "网站后台已接受下发；此结果不等同于设备已执行成功",
  }
}

export async function queryBatteryCommandResult(args: {
  clients: KdbApiClients
  batteryId: string
  generation?: "gen2" | "gen3"
  sessionId?: number
  command?: string
}) {
  const target = normalizedBattery(args.clients, args.batteryId, args.generation)
  if (target.generation === "gen3") {
    if (!args.sessionId) throw new Error("Gen3 命令结果需要 --session-id（由 command send 返回）")
    const response = await getGen3CommandResult(args.clients.gen3, { sessionId: args.sessionId, batteryId: target.batteryId })
    assertAjaxOk({ generation: "gen3", action: "getCommand", result: response.data })
    const message = typeof response.data.data === "string" ? response.data.data : ""
    const status = message === "执行成功" ? "ACKNOWLEDGED" : message ? "PENDING" : "PENDING"
    return { ...target, sessionId: args.sessionId, status, protocolAcknowledged: status === "ACKNOWLEDGED", physicalEffectVerified: false, message: message || "后台尚未收到命令结果" }
  }

  const command = args.command ? resolveBatteryCommand("gen2", "4g", args.command) : undefined
  const response = await listGen2StatusNettyLog(args.clients.gen2, {
    batteryId: target.batteryId,
    ...(command?.gen2?.fourGMsgType ? { msgType: Number(command.gen2.fourGMsgType) } : {}),
    pageNum: 1,
    pageSize: 100,
    sortProp: "id",
    sortOrder: "desc",
  })
  assertTableOk({ generation: "gen2", action: "listStatusNettyLog", result: response.data })
  const rows = response.data.rows ?? []
  const request = rows.find((row) => row.directionType === "2")
  if (!request) return { ...target, status: "PENDING", protocolAcknowledged: false, physicalEffectVerified: false, message: "未找到匹配的 Gen2 下发记录" }
  const acknowledgement = rows.find((row) => row.directionType === "1" && row.msgKey === request.msgKey)
  return {
    ...target,
    command: command?.name ?? null,
    status: acknowledgement ? "ACKNOWLEDGED" : "PENDING",
    protocolAcknowledged: acknowledgement !== undefined,
    physicalEffectVerified: false,
    request,
    ...(acknowledgement ? { acknowledgement } : {}),
    message: acknowledgement ? "设备已返回协议回执；仍需通过状态/现场验证实际效果" : "已找到下发记录，尚未收到匹配回执",
  }
}
