import { randomInt } from "node:crypto"
import type { KdbApiClients } from "../../index.js"
import { assertAjaxOk } from "../../core/api/ajax-result.js"
import { assertTableOk } from "../../core/api/table-data.js"
import { createConfirmationToken, verifyConfirmationToken, type ConfirmationAction } from "../../core/control/confirmation.js"
import { resolveGeneration } from "../../core/config/index.js"
import type { ControlChannel } from "../../domain/control/command-catalog.js"
import {
  addGen2BluetoothTask, getGen2ParameterResult, listGen2Parameters, queueGen2ParameterWrite,
  readAllGen2Parameters, readGen2Parameter,
} from "../../domain/gen2/control/hckd-control-api.js"
import { buildGen2BluetoothParameterMessage } from "../../domain/gen2/control/hckd-parameter-protocol.js"
import {
  getGen3ParameterResult, listGen3BluetoothParameterTasks, listGen3Parameters, readAllGen3Parameters,
  readGen3Parameter, sendGen3BluetoothParameter, setGen3Parameter,
} from "../../domain/gen3/control/kdb-control-api.js"
import {
  assertWritable, parameterValue, resolveParameter, validateParameterValue, type ParameterDefinition,
} from "../../domain/parameters/parameter-types.js"
import { queryBatteryCommandReadiness } from "../status/query-command-readiness.js"
import type { DataSource } from "../../core/data-source.js"
import { createLocalHistoryRepository } from "../../domain/local/local-history-repository.js"

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function target(clients: KdbApiClients, batteryId: string, generation?: "gen2" | "gen3") {
  const normalized = batteryId.trim().toUpperCase()
  const inferred = resolveGeneration(normalized, clients.config)
  if (generation && generation !== inferred) throw new Error(`指定代际 ${generation} 与电池编号推断结果 ${inferred} 不一致`)
  return { batteryId: normalized, generation: generation ?? inferred }
}

export async function listBatteryParameters(args: {
  clients: KdbApiClients; batteryId: string; generation?: "gen2" | "gen3"; search?: string; source?: DataSource
}): Promise<{
  batteryId: string; generation: "gen2" | "gen3"; parameters: ParameterDefinition[]; total: number
  source: "api" | "local"; isHistorical?: true; asOf?: string | null; fallbackFrom?: "api-empty"
}> {
  const info = target(args.clients, args.batteryId, args.generation)
  if (args.source === "local") return listLocalBatteryParameters({ ...args, ...info })
  const query: Record<string, unknown> = { pageNum: 1, pageSize: 10000 }
  if (args.search) query.parameterName = args.search
  const response = info.generation === "gen2"
    ? await listGen2Parameters(args.clients.gen2, query)
    : await listGen3Parameters(args.clients.gen3, query)
  assertTableOk({ generation: info.generation, action: "listParameters", result: response.data })
  const parameters = response.data.rows ?? []
  if (args.source === "auto" && parameters.length === 0) {
    const local = await listLocalBatteryParameters({ ...args, ...info })
    return { ...local, fallbackFrom: "api-empty" as const }
  }
  return { ...info, parameters, total: response.data.total ?? parameters.length, source: "api" as const }
}

async function listLocalBatteryParameters(args: {
  clients: KdbApiClients; batteryId: string; generation: "gen2" | "gen3"; search?: string
}) {
  const rows = await createLocalHistoryRepository(args.clients.config).listParameterDefinitions({ generation: args.generation, ...(args.search ? { search: args.search } : {}) })
  const asOf = rows.reduce<string | null>((latest, row) => String(row.updateTime ?? row.createTime ?? latest ?? "") || latest, null)
  return { batteryId: args.batteryId, generation: args.generation, parameters: rows as ParameterDefinition[], total: rows.length, source: "local" as const, isHistorical: true as const, asOf }
}

export async function resolveBatteryParameter(args: { clients: KdbApiClients; batteryId: string; generation?: "gen2" | "gen3"; selector: string }) {
  const listed = await listBatteryParameters(args)
  return { ...listed, parameter: resolveParameter(listed.parameters, args.selector) }
}

async function pollFourG(args: {
  clients: KdbApiClients; generation: "gen2" | "gen3"; sessionId: number; waitMs: number; all: boolean
}): Promise<ParameterDefinition[]> {
  const deadline = Date.now() + args.waitMs
  do {
    const response = args.generation === "gen2"
      ? await getGen2ParameterResult(args.clients.gen2, args.sessionId)
      : await getGen3ParameterResult(args.clients.gen3, args.sessionId)
    assertTableOk({ generation: args.generation, action: "getParameter", result: response.data })
    const rows = (response.data.rows ?? []).filter((row) => row.parameterId !== undefined && parameterValue(row) !== undefined)
    if (rows.length > 0 && (!args.all || rows.length >= (response.data.total ?? rows.length))) return rows
    if (Date.now() < deadline) await sleep(Math.min(500, Math.max(1, deadline - Date.now())))
  } while (Date.now() < deadline)
  return []
}

export async function readBatteryParameter(args: {
  clients: KdbApiClients
  batteryId: string
  generation?: "gen2" | "gen3"
  channel: ControlChannel
  selector?: string
  all?: boolean
  waitMs?: number
}) {
  const info = target(args.clients, args.batteryId, args.generation)
  const waitMs = args.waitMs ?? args.clients.config.defaults.parameter.wait_ms
  if (args.all && args.selector) throw new Error("--all 与具体参数不能同时使用")
  if (!args.all && !args.selector) throw new Error("请提供参数名/parameterId，或使用 --all")
  if (args.channel === "bluetooth" && args.all) throw new Error("网站蓝牙 API 每次只支持一个参数，请逐项读取")
  const parameter = args.selector ? (await resolveBatteryParameter({ clients: args.clients, ...info, selector: args.selector })).parameter : undefined
  const sessionId = randomInt(1, 0x7fffffff)

  if (args.channel === "4g") {
    const readiness = await queryBatteryCommandReadiness({ clients: args.clients, ...info })
    if (!readiness.canSendCommand) throw new Error(`当前不可通过 4G 读取参数: ${readiness.reason}`)
    const response = info.generation === "gen2"
      ? args.all
        ? await readAllGen2Parameters(args.clients.gen2, { batteryId: info.batteryId, sessionId })
        : await readGen2Parameter(args.clients.gen2, { batteryId: info.batteryId, sessionId, parameterId: parameter!.parameterId })
      : args.all
        ? await readAllGen3Parameters(args.clients.gen3, { batteryId: info.batteryId, sessionId })
        : await readGen3Parameter(args.clients.gen3, { batteryId: info.batteryId, sessionId, parameterId: parameter!.parameterId })
    assertAjaxOk({ generation: info.generation, action: "readParameter", result: response.data })
    const rows = await pollFourG({ clients: args.clients, generation: info.generation, sessionId, waitMs, all: Boolean(args.all) })
    return {
      ...info, channel: args.channel, sessionId, status: rows.length > 0 ? "COMPLETED" : "PENDING_OR_TIMEOUT",
      applied: false, parameters: rows,
      ...(rows.length === 0 ? { message: `后台在 ${waitMs}ms 内未返回参数值，可稍后重试读取` } : {}),
    }
  }

  if (info.generation === "gen2") {
    const message = buildGen2BluetoothParameterMessage({ batteryId: info.batteryId, parameter: parameter!, sessionId })
    const response = await addGen2BluetoothTask(args.clients.gen2, {
      batteryId: info.batteryId, msgId: message.msgId, msgType: "parameter-read", msgKey: message.msgKey,
      msgLog: message.msgLog, executeNum: 0, bluetoothCommandStatus: "1",
    })
    assertAjaxOk({ generation: "gen2", action: "queueBluetoothParameterRead", result: response.data })
    return { ...info, channel: args.channel, sessionId, msgKey: message.msgKey, status: "QUEUED_FOR_APP", applied: false, parameter, parameters: [], message: "读取任务已排队；Gen2 后台只记录 App 回传原始报文，不提供结构化参数任务回填" }
  }
  const response = await sendGen3BluetoothParameter(args.clients.gen3, {
    batteryId: info.batteryId, sessionId, parameterId: parameter!.parameterId, readType: "1",
  })
  assertAjaxOk({ generation: "gen3", action: "queueBluetoothParameterRead", result: response.data })
  const msgKey = sessionId.toString(16).toUpperCase().padStart(8, "0")
  const deadline = Date.now() + waitMs
  do {
    const tasks = await listGen3BluetoothParameterTasks(args.clients.gen3, { batteryId: info.batteryId, msgKey, pageNum: 1, pageSize: 10, orderByColumn: "id", isAsc: "desc" })
    assertTableOk({ generation: "gen3", action: "listBluetoothParameterTasks", result: tasks.data })
    const task = tasks.data.rows?.[0]
    if (task?.bluetoothCommandStatus === "1" && task.parameterContent !== undefined) {
      return { ...info, channel: args.channel, sessionId, msgKey, status: "COMPLETED", applied: false, parameter, parameters: [{ ...parameter, parameterDefault: task.parameterContent }], task }
    }
    if (Date.now() < deadline) await sleep(Math.min(500, Math.max(1, deadline - Date.now())))
  } while (Date.now() < deadline)
  return { ...info, channel: args.channel, sessionId, msgKey, status: "QUEUED_FOR_APP", applied: false, parameter, parameters: [], message: "读取任务已排队，需手机 App 连接后执行；可稍后重新读取" }
}

export async function writeBatteryParameter(args: {
  clients: KdbApiClients
  batteryId: string
  generation?: "gen2" | "gen3"
  channel: ControlChannel
  selector: string
  value: string
  currentValue?: string
  waitMs?: number
  confirmationToken?: string
}) {
  const found = await resolveBatteryParameter({ clients: args.clients, batteryId: args.batteryId, selector: args.selector, ...(args.generation ? { generation: args.generation } : {}) })
  const parameter = found.parameter
  assertWritable(parameter)
  validateParameterValue(parameter, args.value)
  let oldValue = args.currentValue
  if (oldValue === undefined) {
    const read = await readBatteryParameter({ clients: args.clients, batteryId: found.batteryId, generation: found.generation, channel: args.channel, selector: args.selector, ...(args.waitMs !== undefined ? { waitMs: args.waitMs } : {}) })
    oldValue = parameterValue(read.parameters[0] ?? {})
    if (oldValue === undefined) {
      return { phase: "awaiting-current-value" as const, ...read, requestedValue: args.value, next: "等待读取完成后重试；Gen2 蓝牙可从 App/原始回报确认旧值，并用 --current-value <值> 继续" }
    }
  }
  const action: ConfirmationAction = {
    kind: "parameter-write", generation: found.generation, channel: args.channel, batteryId: found.batteryId,
    operation: String(parameter.parameterId), payload: { oldValue, newValue: args.value },
  }
  if (!args.confirmationToken) {
    return { phase: "preview" as const, action, parameter, oldValue, newValue: args.value, ...createConfirmationToken(action, args.clients.config), next: "确认参数、旧值和新值后，使用完全相同的参数并添加 --confirm <confirmationToken>" }
  }
  verifyConfirmationToken(action, args.confirmationToken, args.clients.config)
  return executeBatteryParameterWrite({ clients: args.clients, batteryId: found.batteryId, generation: found.generation, channel: args.channel, parameter, oldValue, value: args.value })
}

/** Executes a pre-validated parameter change after the caller's confirmation gate. */
export async function executeBatteryParameterWrite(args: {
  clients: KdbApiClients
  batteryId: string
  generation: "gen2" | "gen3"
  channel: ControlChannel
  parameter: ParameterDefinition
  oldValue: string
  value: string
}) {
  const sessionId = randomInt(1, 0x7fffffff)
  if (args.generation === "gen2") {
    if (args.channel === "4g") {
      const response = await queueGen2ParameterWrite(args.clients.gen2, { batteryId: args.batteryId, parameterId: String(args.parameter.parameterId), parameterValue: args.value, parameterReadValue: args.oldValue })
      assertAjaxOk({ generation: "gen2", action: "writeParameter", result: response.data })
    } else {
      const message = buildGen2BluetoothParameterMessage({ batteryId: args.batteryId, parameter: args.parameter, sessionId, value: args.value })
      const response = await addGen2BluetoothTask(args.clients.gen2, { batteryId: args.batteryId, msgId: message.msgId, msgType: "parameter-write", msgKey: message.msgKey, msgLog: message.msgLog, executeNum: 0, bluetoothCommandStatus: "1" })
      assertAjaxOk({ generation: "gen2", action: "queueBluetoothParameterWrite", result: response.data })
    }
  } else if (args.channel === "4g") {
    const response = await setGen3Parameter(args.clients.gen3, { batteryId: args.batteryId, sessionId, parameterId: args.parameter.parameterId, newData: args.value })
    assertAjaxOk({ generation: "gen3", action: "writeParameter", result: response.data })
  } else {
    const response = await sendGen3BluetoothParameter(args.clients.gen3, { batteryId: args.batteryId, sessionId, parameterId: args.parameter.parameterId, readType: "2", newData: args.value })
    assertAjaxOk({ generation: "gen3", action: "queueBluetoothParameterWrite", result: response.data })
  }
  return {
    phase: "submitted" as const, batteryId: args.batteryId, generation: args.generation, channel: args.channel,
    sessionId, parameter: args.parameter, oldValue: args.oldValue, newValue: args.value,
    status: args.channel === "bluetooth" || args.generation === "gen2" ? "QUEUED" : "SENT",
    applied: false,
    message: args.channel === "bluetooth" ? "参数写入已进入蓝牙任务队列，需 App 执行；尚不能声明已生效" : args.generation === "gen2" ? "参数写入已进入 Gen2 后台任务队列；尚不能声明已生效" : "后台已接受参数设置；请再次读取确认最终值",
  }
}
