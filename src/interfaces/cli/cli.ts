#!/usr/bin/env node

import process from "node:process"
import { readFile } from "node:fs/promises"
import {
  createKdbClients,
  controlBatteryCommand,
  controlBatteryBatch,
  exportBatteryRealtimeData,
  exportBatteryRealtimeBatch,
  exportExcel,
  getBatteryCommandCatalog,
  listBatteryParameters,
  queryBatteryCommandReadiness,
  queryBatteryCommandResult,
  queryBatchBatteryStatus,
  queryBatteryStatusById,
  queryOtaVersion,
  queryCurrentOtaFirmware,
  listOtaFirmware,
  inspectOtaPreconditions,
  startOtaUpgrade,
  queryOtaResult,
  setOtaFirmwareStatus,
  listOtaFirmwareStatusHistory,
  rollbackOtaFirmwareStatus,
  parseBatchTargetText,
  readBatteryParameter,
  readBatteryParameterBatch,
  resolveTimeRange,
  type ExportType,
  type ControlChannel,
  writeBatteryParameter,
  writeBatteryParameterBatch,
} from "../../index.js"
import { resolveGeneration } from "../../core/config/index.js"
import type { QueryObject, QueryValue } from "../../core/http/http-client.js"

const VERSION = "1.0.0"
const EXPORT_TYPES: ExportType[] = [
  "batteryBase",
  "latestBatteryTable",
  "nettyLog",
  "statusNettyLog",
  "bluetoothCommandTasks",
  "realtimeMsgLog",
  "reportBatteryLog",
  "cycle01MsgLog",
  "statusCommandLog",
]
const GEN2_ONLY = new Set<ExportType>([
  "latestBatteryTable",
  "nettyLog",
  "statusNettyLog",
  "bluetoothCommandTasks",
  "realtimeMsgLog",
])
const GEN3_ONLY = new Set<ExportType>(["reportBatteryLog", "cycle01MsgLog", "statusCommandLog"])
const BOOLEAN_OPTIONS = new Set(["help", "version", "json", "all", "detail", "raw", "allow-downgrade"])
const ALIASES: Record<string, string> = {
  b: "battery-id",
  g: "generation",
  o: "output",
  H: "hours",
  h: "help",
  "电池": "battery-id",
  "通道": "channel",
  "确认": "confirm",
  "输出": "output",
  "明细": "detail",
  "原始": "raw",
  "清单": "battery-file",
  "固件": "firmware-id",
  "固件号": "firmware-id",
  "固件版本": "firmware-version",
  "固件名称": "firmware-name",
  "固件名": "firmware-name",
  "允许降级": "allow-downgrade",
}

const TOP_LEVEL_ALIASES: Record<string, string> = {
  "电池": "battery",
  "状态": "status",
  "就绪": "ready",
  "控制": "command",
  "参数": "parameter",
  "导出": "export",
  "批量": "batch",
  "升级": "ota",
}

const SUBCOMMAND_ALIASES: Record<string, string> = {
  "状态": "status", "就绪": "ready", "模式": "mode", "控制": "command", "参数": "parameter", "导出": "export",
  "查询": "get", "获取": "get", "读取": "get", "设置": "set", "查找": "find", "结果": "result", "发送": "send", "列表": "list", "历史": "history", "回滚": "rollback", "推送状态": "status",
  "升级": "ota", "版本": "version", "固件列表": "list", "当前固件": "current", "检查": "inspect", "开始": "start",
}

type ParsedArgs = { positionals: string[]; options: Map<string, string[]> }

function help(): string {
  return `KDB 电池数据 SDK/CLI

用法:
  kdb export realtime --battery-id <编号> [时间选项] [--output <文件>]
  kdb export <类型> [--generation gen2|gen3] [筛选选项]
  kdb status --battery-id <编号>
  kdb command-ready --battery-id <编号>
  kdb command list --battery-id <编号> [--channel 4g|bluetooth]
  kdb command send <命令名> --battery-id <编号> --channel 4g|bluetooth [--value <值>] [--confirm <令牌>]
  kdb parameter list --battery-id <编号> [--search <名称>]
  kdb parameter read <参数名或ID> --battery-id <编号> --channel 4g|bluetooth
  kdb parameter read --all --battery-id <编号> --channel 4g
  kdb parameter write <参数名或ID> <新值> --battery-id <编号> --channel 4g|bluetooth [--current-value <旧值>] [--confirm <令牌>]
  kdb battery status|状态 --battery-id <编号> [--detail|--raw]
  kdb battery mode get|查询 --battery-id <编号>
  kdb battery mode set|设置 <normal|test|lock|emergency|中文模式> --battery-id <编号> [--confirm <令牌>]
  kdb battery command send|发送 <命令或中文别名> --battery-id <编号> [--confirm <令牌>]
  kdb battery parameter find|查找 --search <关键词> --battery-id <编号>
  kdb battery parameter get|读取 <参数> --battery-id <编号>
  kdb batch status --battery-id <编号> [--battery-id <编号> ...|--battery-file <txt/csv>]
  kdb batch command send <命令> --battery-file <清单> [--confirm <令牌>]
  kdb batch parameter read|write <参数> [新值] --battery-file <清单> [--confirm <令牌>]
  kdb batch export realtime --battery-file <清单> --output-dir <目录> [时间选项]
  kdb battery ota version -b <编号>
  kdb battery ota firmware list -b <编号>
  kdb battery ota firmware current -b <编号>
  kdb battery ota firmware status set -b <编号> [--firmware-id <固件ID> | --firmware-version <版本> | --firmware-name <名称>] --status 1|2 [--confirm <令牌>]
  kdb battery ota firmware status history [-b <编号>] [--limit <数量>]
  kdb battery ota firmware status rollback -b <编号> [--operation-id <记录ID>] [--confirm <令牌>]
  kdb battery ota inspect -b <编号> [--firmware-id <固件ID> | --firmware-version <版本> | --firmware-name <名称>] [--allow-downgrade]
  kdb battery ota start -b <编号> [--firmware-id <固件ID> | --firmware-version <版本> | --firmware-name <名称>] [--allow-downgrade] [--confirm <令牌>]
  kdb battery ota result -b <编号> [--session-id <会话ID>] [--firmware-id <固件ID> --target-version <版本>]

实时数据导出:
  --battery-id, -b <编号>    必填；自动判断 Gen2/Gen3
  --start <时间>             开始时间，如 "2026-07-01 00:00:00"
  --end <时间>               结束时间；默认当前时间
  --hours, -H <小时>         未传 start 时向前取多少小时，默认 24
  --output, -o <路径>        自定义 xlsx 输出路径
  --generation, -g <代际>   可选校验值：gen2 或 gen3

通用导出:
  类型: ${EXPORT_TYPES.join(", ")}
  --query <key=value>        顶层查询参数，可重复
  --param <key=value>        params[key] 查询参数，可重复
  --start/--end/--hours      日志时间范围；Gen2 映射 createTime，Gen3 映射 logTime

全局选项:
  --root-dir <目录>          包含 config/ 的项目或配置根目录
  --help, -h                 显示帮助
  --version                  显示版本

命令可下发性:
  command-ready（别名 ready）只查询状态，不会发送测试命令。
  可以下发时退出码为 0；不可下发或状态未知时退出码为 2。

控制与参数:
  --channel <通道>          必填：4g 或 bluetooth
  --confirm <令牌>          命令/参数写入预览返回的 5 分钟确认令牌
  --current-value <值>      异步蓝牙无法及时读回时，显式提供已确认的旧值
  --wait-ms <毫秒>          参数读取等待时间；默认取 config/kdb.toml
  --all                     读取全部参数；网站蓝牙 API 不支持批量
  --min-data-count <数量>   OTA 兼容参数；当前仅统计实时数据，不作为阻塞条件
  命令和参数写入第一次调用只预览，不会下发；OTA 仅支持下方第一阶段单电池 4G 流程，系统升级不支持。
  新 battery/电池 入口未指定通道时默认 4g；旧 command/parameter 命令仍要求显式 --channel。
  batch/批量仅接受重复 --battery-id 或 --battery-file 的显式目标（最多 100），仅支持 4g，不允许混合 Gen2/Gen3。
  command result/结果 可查询下发回执；协议回执不等同于设备物理效果已验证。
  OTA 第一阶段仅支持单电池 4G；start 首次只预览，确认后才切换固件推送状态并发送 OTA 启动指令。
  固件推送状态 set/rollback 首次只预览；history 读取本地 out/ota-firmware-status-history.jsonl 记录。
  固件选择 --firmware-id/--firmware-version/--firmware-name 三选一；版本号或名称重复时必须改用固件 ID。

示例:
  kdb export realtime -b 8F9AE708 --start "2026-07-01 00:00:00" --end "2026-07-02 00:00:00"
  kdb export realtime -b 62413828 --hours 6 -o out/realtime.xlsx
  kdb export nettyLog -b 8F9AE708 --param beginCreateTime="2026-07-01 00:00:00"
  kdb export batteryBase --generation gen3 --query batteryStatus=1
  kdb status -b 62413828
  kdb command-ready -b 62413828
  kdb command list -b 62413828 --channel 4g
  kdb command send reboot -b 62413828 --channel 4g
  kdb parameter list -b 62413828
  kdb parameter read 12 -b 62413828 --channel 4g
  kdb parameter write 12 42 -b 62413828 --channel 4g
`
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = []
  const options = new Map<string, string[]>()
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!
    if (!token.startsWith("-") || token === "-") {
      positionals.push(token)
      continue
    }

    const isLong = token.startsWith("--")
    const raw = token.slice(isLong ? 2 : 1)
    const equalsAt = raw.indexOf("=")
    const rawName = equalsAt >= 0 ? raw.slice(0, equalsAt) : raw
    const name = ALIASES[rawName] ?? rawName
    if (!name) throw new Error(`无效选项: ${token}`)

    let value: string
    if (equalsAt >= 0) {
      value = raw.slice(equalsAt + 1)
    } else if (BOOLEAN_OPTIONS.has(name)) {
      value = "true"
    } else {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("-")) throw new Error(`选项 --${name} 缺少值`)
      value = next
      i++
    }
    options.set(name, [...(options.get(name) ?? []), value])
  }
  return { positionals, options }
}

function option(args: ParsedArgs, name: string): string | undefined {
  return args.options.get(name)?.at(-1)
}

function requiredOption(args: ParsedArgs, name: string): string {
  const value = option(args, name)?.trim()
  if (!value) throw new Error(`缺少必填选项 --${name}`)
  return value
}

function validateOptions(args: ParsedArgs, allowed: string[]): void {
  const allowedSet = new Set([...allowed, "root-dir", "help", "version"])
  for (const name of args.options.keys()) {
    if (!allowedSet.has(name)) throw new Error(`未知选项 --${name}`)
  }
}

function parsePairs(values: string[] | undefined, optionName: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const value of values ?? []) {
    const index = value.indexOf("=")
    if (index <= 0) throw new Error(`--${optionName} 必须使用 key=value 格式: ${value}`)
    const key = value.slice(0, index).trim()
    const item = value.slice(index + 1).trim()
    if (!key) throw new Error(`--${optionName} 的 key 不能为空`)
    result[key] = item
  }
  return result
}

function parseHours(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const hours = Number(value)
  if (!Number.isFinite(hours) || hours <= 0) throw new Error("--hours 必须是大于 0 的数字")
  return hours
}

function parseGeneration(value: string | undefined): "gen2" | "gen3" | undefined {
  if (value === undefined || value === "auto") return undefined
  if (value === "gen2" || value === "gen3") return value
  throw new Error("--generation 只支持 gen2、gen3 或 auto")
}

function parseChannel(value: string | undefined, required = true): ControlChannel | undefined {
  const normalized = value?.trim().toLowerCase()
  if (normalized === "4g") return "4g"
  if (normalized === "bluetooth" || value?.trim() === "蓝牙") return "bluetooth"
  if (value === undefined && !required) return undefined
  throw new Error("--channel 只支持 4g 或 bluetooth")
}

function normalizedSubcommand(value: string | undefined): string | undefined {
  return value ? (SUBCOMMAND_ALIASES[value] ?? value) : undefined
}

function compactStatus(result: Awaited<ReturnType<typeof queryBatteryStatusById>>, readiness?: Awaited<ReturnType<typeof queryBatteryCommandReadiness>>) {
  const summary = result.summary
  return {
    batteryId: result.batteryId,
    generation: result.generation,
    found: result.found,
    status: summary ? {
      networkStatus: summary.networkStatus,
      networkStatusText: readiness?.networkStatusText,
      networkTime: summary.networkTime,
      registration: readiness?.registration,
      registrationText: readiness?.registrationText,
      workingModeStatus: summary.workingModeStatus,
      workingModeText: summary.workingModeText,
      faultStatus: summary.faultStatus,
      chargeDischargeStatus: summary.chargeDischargeStatus,
      latestReportTime: result.latestReport?.logTime ?? summary.logTime,
    } : null,
  }
}

function compactParameter(parameter: Record<string, unknown>) {
  return {
    parameterId: parameter.parameterId,
    name: parameter.parameterName,
    alias: parameter.parameterAlias,
    value: parameter.oldValue ?? parameter.parameterDefault,
    unit: parameter.parameterUnit,
    min: parameter.parameterMin,
    max: parameter.parameterMax,
    type: parameter.parameterDataType,
    permission: parameter.parameterPower,
  }
}

function compactParameterResult(result: Awaited<ReturnType<typeof readBatteryParameter>>) {
  return {
    batteryId: result.batteryId,
    generation: result.generation,
    channel: result.channel,
    sessionId: result.sessionId,
    status: result.status,
    applied: result.applied,
    parameters: result.parameters.map(compactParameter),
  }
}

function compactParameterWrite(result: Awaited<ReturnType<typeof writeBatteryParameter>>) {
  if (result.phase === "preview") {
    return {
      phase: result.phase, batteryId: result.action.batteryId, generation: result.action.generation, channel: result.action.channel,
      parameter: compactParameter(result.parameter), oldValue: result.oldValue, newValue: result.newValue,
      confirmationToken: result.confirmationToken, expiresAt: result.expiresAt, next: result.next,
    }
  }
  return result
}

async function collectBatteryIds(args: ParsedArgs): Promise<string[]> {
  const explicit = args.options.get("battery-id") ?? []
  const file = option(args, "battery-file")?.trim()
  if (!file) return explicit
  const contents = await readFile(file, "utf8")
  return [...explicit, ...parseBatchTargetText(contents)]
}

/** Stable operation vocabulary for the Agent-oriented command family. */
function agentOperationOutput<T>(result: T): T | (T & { status: string; phase?: string }) {
  if (!result || typeof result !== "object") return result
  const value = result as T & { phase?: string; status?: string }
  const status = value.status === "QUEUED" ? "PENDING" : value.status
  if (value.phase === "preview") return { ...value, phase: "PREVIEW", status: "PREVIEW" }
  if (value.phase === "preview-blocked") return { ...value, phase: "PREVIEW", status: "PENDING" }
  if (value.phase === "execution-blocked") return { ...value, phase: "PENDING", status: "PENDING" }
  if (value.phase === "awaiting-current-value") return { ...value, phase: "PENDING", status: "PENDING" }
  return status === value.status ? value : { ...value, status }
}

function parseWaitMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const waitMs = Number(value)
  if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > 120000) throw new Error("--wait-ms 必须是 0~120000 的整数")
  return waitMs
}

async function createClients(args: ParsedArgs) {
  const rootDir = option(args, "root-dir")?.trim()
  return rootDir ? createKdbClients(rootDir) : createKdbClients()
}

async function runRealtime(args: ParsedArgs): Promise<void> {
  validateOptions(args, ["battery-id", "start", "end", "hours", "output", "generation"])
  const batteryId = requiredOption(args, "battery-id")
  const clients = await createClients(args)
  const outputPath = option(args, "output")?.trim()
  const start = option(args, "start")
  const end = option(args, "end")
  const hours = parseHours(option(args, "hours"))
  const generation = parseGeneration(option(args, "generation"))
  const result = await exportBatteryRealtimeData({
    clients,
    batteryId,
    ...(start !== undefined ? { start } : {}),
    ...(end !== undefined ? { end } : {}),
    ...(hours !== undefined ? { hours } : {}),
    ...(generation !== undefined ? { generation } : {}),
    ...(outputPath ? { outputPath } : {}),
  })
  process.stdout.write(
    `导出完成\n代际: ${result.generation}\n时间: ${result.start} ~ ${result.end}\n文件: ${result.outputPath}\n`,
  )
}

async function runGenericExport(args: ParsedArgs, typeText: string): Promise<void> {
  validateOptions(args, [
    "battery-id",
    "generation",
    "output",
    "query",
    "param",
    "start",
    "end",
    "hours",
  ])
  if (!EXPORT_TYPES.includes(typeText as ExportType)) {
    throw new Error(`未知导出类型 ${typeText}，可选值: ${EXPORT_TYPES.join(", ")}`)
  }
  const type = typeText as ExportType
  const clients = await createClients(args)
  const batteryId = option(args, "battery-id")?.trim()
  const requestedGeneration = parseGeneration(option(args, "generation"))
  const inferredGeneration = batteryId ? resolveGeneration(batteryId, clients.config) : undefined
  if (requestedGeneration && inferredGeneration && requestedGeneration !== inferredGeneration) {
    throw new Error(`指定代际 ${requestedGeneration} 与电池编号推断结果 ${inferredGeneration} 不一致`)
  }
  const generation =
    requestedGeneration ??
    inferredGeneration ??
    (GEN2_ONLY.has(type) ? "gen2" : GEN3_ONLY.has(type) ? "gen3" : undefined)
  if (!generation) throw new Error(`${type} 同时支持两代，请提供 --generation 或 --battery-id`)
  if (generation === "gen2" && GEN3_ONLY.has(type)) throw new Error(`gen2 不支持导出类型 ${type}`)
  if (generation === "gen3" && GEN2_ONLY.has(type)) throw new Error(`gen3 不支持导出类型 ${type}`)

  const topLevel = parsePairs(args.options.get("query"), "query")
  const params = parsePairs(args.options.get("param"), "param")
  if (batteryId) {
    if (type === "latestBatteryTable") params.likeBatteryId = batteryId
    else topLevel.batteryId = batteryId
  }

  const hasTimeOption = ["start", "end", "hours"].some((name) => args.options.has(name))
  if (hasTimeOption) {
    const start = option(args, "start")
    const end = option(args, "end")
    const hours = parseHours(option(args, "hours"))
    const range = resolveTimeRange({
      ...(start !== undefined ? { start } : {}),
      ...(end !== undefined ? { end } : {}),
      ...(hours !== undefined ? { hours } : {}),
    })
    if (generation === "gen2") {
      params.beginCreateTime = range.startText
      params.endCreateTime = range.endText
    } else {
      params.beginLogTime = range.startText
      params.endLogTime = range.endText
    }
  }

  const query: QueryObject = { ...(topLevel as Record<string, QueryValue>) }
  if (Object.keys(params).length > 0) query.params = params
  const outputPath = option(args, "output")?.trim()
  const result = await exportExcel({
    clients,
    generation,
    type,
    ...(Object.keys(query).length > 0 ? { query } : {}),
    ...(outputPath ? { outputPath } : {}),
  })
  process.stdout.write(`导出完成\n代际: ${generation}\n类型: ${type}\n文件: ${result.outputPath}\n`)
}

async function runStatus(args: ParsedArgs, concise = false): Promise<void> {
  validateOptions(args, ["battery-id", "generation", "json", "detail", "raw"])
  const batteryId = requiredOption(args, "battery-id")
  const clients = await createClients(args)
  const generation = parseGeneration(option(args, "generation"))
  const result = await queryBatteryStatusById({
    clients,
    batteryId,
    ...(generation ? { generation } : {}),
  })
  const readiness = concise ? await queryBatteryCommandReadiness({ clients, batteryId, ...(generation ? { generation } : {}) }) : undefined
  const output = !concise || args.options.has("raw")
    ? result
    : args.options.has("detail")
      ? { ...compactStatus(result, readiness), details: result.details, detailFieldLabels: result.detailFieldLabels, latestReport: result.latestReport, latestRealtime: result.latestRealtime }
      : compactStatus(result, readiness)
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
}

async function runCommandReady(args: ParsedArgs): Promise<void> {
  validateOptions(args, ["battery-id", "generation", "json"])
  const batteryId = requiredOption(args, "battery-id")
  const clients = await createClients(args)
  const generation = parseGeneration(option(args, "generation"))
  const result = await queryBatteryCommandReadiness({
    clients,
    batteryId,
    ...(generation ? { generation } : {}),
  })

  if (args.options.has("json")) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    process.stdout.write(
      [
        `可以直接下发: ${result.canSendCommand ? "是" : "否"}`,
        `结论: ${result.state}（${result.stateText}）`,
        `电池: ${result.batteryId} / ${result.generation}`,
        `4G 网络: ${result.networkStatusText}${result.networkTime ? `，最后状态时间 ${result.networkTime}` : ""}`,
        `注册: ${result.registrationText}`,
        `原因: ${result.reason}`,
        "说明: 此命令不发送探测指令；真正下发时后台仍会复核实时 Netty 通道。",
      ].join("\n") + "\n",
    )
  }
  if (!result.canSendCommand) process.exitCode = 2
}

async function runCommand(args: ParsedArgs, agentStyle = false): Promise<void> {
  const subcommand = normalizedSubcommand(args.positionals[1])
  if (subcommand === "list") {
    validateOptions(args, ["battery-id", "generation", "channel", "json"])
    if (args.positionals.length > 2) throw new Error(`多余参数: ${args.positionals.slice(2).join(" ")}`)
    const clients = await createClients(args)
    const generation = parseGeneration(option(args, "generation"))
    const channel = parseChannel(option(args, "channel"), false)
    const result = getBatteryCommandCatalog({ clients, batteryId: requiredOption(args, "battery-id"), ...(generation ? { generation } : {}), ...(channel ? { channel } : {}) })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (subcommand === "result") {
    validateOptions(args, ["battery-id", "generation", "session-id", "command", "json"])
    if (args.positionals.length > 2) throw new Error(`多余参数: ${args.positionals.slice(2).join(" ")}`)
    const clients = await createClients(args)
    const generation = parseGeneration(option(args, "generation"))
    const sessionIdText = option(args, "session-id")
    const sessionId = sessionIdText === undefined ? undefined : Number(sessionIdText)
    if (sessionIdText !== undefined && (!Number.isInteger(sessionId) || sessionId! <= 0)) throw new Error("--session-id 必须是正整数")
    const result = await queryBatteryCommandResult({
      clients, batteryId: requiredOption(args, "battery-id"), ...(generation ? { generation } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}), ...(option(args, "command") ? { command: option(args, "command")! } : {}),
    })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (subcommand === "send") {
    validateOptions(args, ["battery-id", "generation", "channel", "value", "confirm", "json"])
    const command = args.positionals[2]
    if (!command) throw new Error("command send 缺少命令名；请先运行 command list")
    if (args.positionals.length > 3) throw new Error(`多余参数: ${args.positionals.slice(3).join(" ")}`)
    const clients = await createClients(args)
    const generation = parseGeneration(option(args, "generation"))
    const result = await controlBatteryCommand({
      clients, batteryId: requiredOption(args, "battery-id"), channel: parseChannel(option(args, "channel"))!, command,
      ...(generation ? { generation } : {}),
      ...(option(args, "value") !== undefined ? { value: option(args, "value")! } : {}),
      ...(option(args, "confirm") ? { confirmationToken: option(args, "confirm")! } : {}),
    })
    process.stdout.write(`${JSON.stringify(agentStyle ? agentOperationOutput(result) : result, null, 2)}\n`)
    return
  }
  throw new Error("command 只支持 list、send 或 result")
}

async function runParameter(args: ParsedArgs, agentStyle = false): Promise<void> {
  const subcommand = normalizedSubcommand(args.positionals[1])
  if (subcommand === "list" || subcommand === "find") {
    validateOptions(args, ["battery-id", "generation", "search", "json", "detail"])
    const positionalSearch = args.positionals[2]
    if (args.positionals.length > 3) throw new Error(`多余参数: ${args.positionals.slice(3).join(" ")}`)
    if (positionalSearch && option(args, "search")) throw new Error("参数关键词请使用位置参数或 --search 二选一")
    const clients = await createClients(args)
    const generation = parseGeneration(option(args, "generation"))
    const search = positionalSearch ?? option(args, "search")
    const result = await listBatteryParameters({ clients, batteryId: requiredOption(args, "battery-id"), ...(generation ? { generation } : {}), ...(search ? { search } : {}) })
    const output = !agentStyle || args.options.has("detail") ? result : { batteryId: result.batteryId, generation: result.generation, total: result.total, parameters: result.parameters.map(compactParameter) }
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
    return
  }
  if (subcommand === "read" || subcommand === "get") {
    validateOptions(args, ["battery-id", "generation", "channel", "wait-ms", "all", "json", "detail"])
    if (args.positionals.length > 3) throw new Error(`多余参数: ${args.positionals.slice(3).join(" ")}`)
    const clients = await createClients(args)
    const generation = parseGeneration(option(args, "generation"))
    const waitMs = parseWaitMs(option(args, "wait-ms"))
    const result = await readBatteryParameter({
      clients, batteryId: requiredOption(args, "battery-id"), channel: parseChannel(option(args, "channel"))!,
      ...(generation ? { generation } : {}), ...(args.positionals[2] ? { selector: args.positionals[2] } : {}),
      ...(args.options.has("all") ? { all: true } : {}), ...(waitMs !== undefined ? { waitMs } : {}),
    })
    process.stdout.write(`${JSON.stringify(!agentStyle || args.options.has("detail") ? result : compactParameterResult(result), null, 2)}\n`)
    return
  }
  if (subcommand === "write" || subcommand === "set") {
    validateOptions(args, ["battery-id", "generation", "channel", "wait-ms", "current-value", "confirm", "json", "detail"])
    const selector = args.positionals[2]
    const value = args.positionals[3]
    if (!selector || value === undefined) throw new Error("parameter write 需要 <参数名或ID> <新值>")
    if (args.positionals.length > 4) throw new Error(`多余参数: ${args.positionals.slice(4).join(" ")}`)
    const clients = await createClients(args)
    const generation = parseGeneration(option(args, "generation"))
    const waitMs = parseWaitMs(option(args, "wait-ms"))
    const result = await writeBatteryParameter({
      clients, batteryId: requiredOption(args, "battery-id"), channel: parseChannel(option(args, "channel"))!, selector, value,
      ...(generation ? { generation } : {}), ...(waitMs !== undefined ? { waitMs } : {}),
      ...(option(args, "current-value") !== undefined ? { currentValue: option(args, "current-value")! } : {}),
      ...(option(args, "confirm") ? { confirmationToken: option(args, "confirm")! } : {}),
    })
    const output = !agentStyle || args.options.has("detail") ? result : compactParameterWrite(result)
    process.stdout.write(`${JSON.stringify(agentStyle ? agentOperationOutput(output) : output, null, 2)}\n`)
    return
  }
  throw new Error("parameter 只支持 list/find、read/get 或 write/set")
}

function withDefaultFourG(args: ParsedArgs): ParsedArgs {
  if (args.options.has("channel")) return args
  const options = new Map(args.options)
  options.set("channel", ["4g"])
  return { ...args, options }
}

function withJsonOutput(args: ParsedArgs): ParsedArgs {
  if (args.options.has("json")) return args
  const options = new Map(args.options)
  options.set("json", ["true"])
  return { ...args, options }
}

function modeCommand(value: string, generation: "gen2" | "gen3"): string {
  const modes: Record<string, string> = {
    normal: "mode-normal", "正常": "mode-normal", "正常模式": "mode-normal",
    test: "mode-test", "测试": "mode-test", "测试模式": "mode-test",
    lock: "mode-lock", "锁电": "mode-lock", "锁电模式": "mode-lock",
    emergency: "mode-emergency", "应急": "mode-emergency", "应急模式": "mode-emergency",
  }
  const command = modes[value.toLowerCase()] ?? modes[value]
  if (!command) throw new Error("模式只支持 normal/test/lock/emergency 或 正常/测试/锁电/应急")
  if (generation === "gen2") {
    if (command === "mode-lock") return "lock"
    if (command === "mode-normal") return "unlock"
    throw new Error("Gen2 仅支持锁电/正常（解锁）模式；测试和应急模式不支持直接设置")
  }
  return command
}

async function runMode(args: ParsedArgs): Promise<void> {
  const subcommand = normalizedSubcommand(args.positionals[1]) ?? "get"
  if (subcommand === "get") {
    validateOptions(args, ["battery-id", "generation", "detail", "raw", "json"])
    if (args.positionals.length > 2) throw new Error(`多余参数: ${args.positionals.slice(2).join(" ")}`)
    const clients = await createClients(args)
    const generation = parseGeneration(option(args, "generation"))
    const result = await queryBatteryStatusById({ clients, batteryId: requiredOption(args, "battery-id"), ...(generation ? { generation } : {}) })
    const code = result.summary?.workingModeStatus
    const english = code === "0" ? "normal" : code === "1" ? "test" : code === "2" ? "lock" : code === "3" ? "emergency" : null
    process.stdout.write(`${JSON.stringify({ batteryId: result.batteryId, generation: result.generation, mode: english, modeText: result.summary?.workingModeText ?? null, workingModeStatus: code ?? null, latestReportTime: result.latestRealtime?.logTime ?? null }, null, 2)}\n`)
    return
  }
  if (subcommand !== "set") throw new Error("mode 只支持 get/查询 或 set/设置")
  validateOptions(args, ["battery-id", "generation", "channel", "confirm", "json"])
  const value = args.positionals[2]
  if (!value) throw new Error("mode set 需要模式值，例如 lock 或 锁电模式")
  if (args.positionals.length > 3) throw new Error(`多余参数: ${args.positionals.slice(3).join(" ")}`)
  const clients = await createClients(args)
  const generation = parseGeneration(option(args, "generation"))
  const batteryId = requiredOption(args, "battery-id")
  const targetGeneration = generation ?? resolveGeneration(batteryId, clients.config)
  const result = await controlBatteryCommand({
    clients, batteryId, channel: parseChannel(option(args, "channel"))!, command: modeCommand(value, targetGeneration),
    ...(generation ? { generation } : {}), ...(option(args, "confirm") ? { confirmationToken: option(args, "confirm")! } : {}),
  })
  process.stdout.write(`${JSON.stringify(agentOperationOutput(result), null, 2)}\n`)
}

function compactFirmware(firmware: Record<string, unknown>) {
  return {
    id: firmware.id,
    name: firmware.firmwareName,
    version: firmware.firmwareVersion,
    fileName: firmware.firmwareFileName,
    size: firmware.firmwareSize,
    status: firmware.firmwareStatus,
    pushCount: firmware.firmwarePushNum,
    type: firmware.firmwareType,
    serialNumber: firmware.serialNumber,
    description: firmware.description,
  }
}

function positiveIntegerOption(args: ParsedArgs, name: string): number | undefined {
  const value = option(args, name)
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`--${name} 必须是正整数`)
  return parsed
}

function firmwareSelectorOptions(args: ParsedArgs): { firmwareId?: string; firmwareVersion?: string; firmwareName?: string } {
  const firmwareId = option(args, "firmware-id")?.trim()
  const firmwareVersion = option(args, "firmware-version")?.trim()
  const firmwareName = option(args, "firmware-name")?.trim()
  if ([firmwareId, firmwareVersion, firmwareName].filter(Boolean).length !== 1) {
    throw new Error("必须且只能提供 --firmware-id、--firmware-version 或 --firmware-name 其中一个")
  }
  if (firmwareId) return { firmwareId }
  if (firmwareVersion) return { firmwareVersion }
  return { firmwareName: firmwareName! }
}

function firmwareStatusOption(args: ParsedArgs): "1" | "2" {
  const value = requiredOption(args, "status")
  if (value !== "1" && value !== "2") throw new Error("--status 只支持 1（停用）或 2（推送）")
  return value
}

async function runOtaFirmwareStatus(args: ParsedArgs): Promise<void> {
  const action = normalizedSubcommand(args.positionals[3])
  if (action === "set") {
    validateOptions(args, ["battery-id", "generation", "firmware-id", "firmware-version", "firmware-name", "status", "confirm", "history-file", "json"])
    if (args.positionals.length > 4) throw new Error(`多余参数: ${args.positionals.slice(4).join(" ")}`)
    const clients = await createClients(args)
    const generation = parseGeneration(option(args, "generation"))
    const firmwareSelector = firmwareSelectorOptions(args)
    const result = await setOtaFirmwareStatus({
      clients,
      batteryId: requiredOption(args, "battery-id"),
      ...firmwareSelector,
      status: firmwareStatusOption(args),
      ...(generation ? { generation } : {}),
      ...(option(args, "confirm") ? { confirmationToken: option(args, "confirm")! } : {}),
      ...(option(args, "history-file") ? { historyFile: option(args, "history-file")! } : {}),
    })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (action === "history") {
    validateOptions(args, ["battery-id", "generation", "limit", "history-file", "json"])
    if (args.positionals.length > 4) throw new Error(`多余参数: ${args.positionals.slice(4).join(" ")}`)
    const clients = await createClients(args)
    const generation = parseGeneration(option(args, "generation"))
    const limit = positiveIntegerOption(args, "limit")
    const result = await listOtaFirmwareStatusHistory({
      clients,
      ...(option(args, "battery-id") ? { batteryId: option(args, "battery-id")! } : {}),
      ...(generation ? { generation } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(option(args, "history-file") ? { historyFile: option(args, "history-file")! } : {}),
    })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (action === "rollback") {
    validateOptions(args, ["battery-id", "generation", "operation-id", "confirm", "history-file", "json"])
    if (args.positionals.length > 4) throw new Error(`多余参数: ${args.positionals.slice(4).join(" ")}`)
    const clients = await createClients(args)
    const generation = parseGeneration(option(args, "generation"))
    const result = await rollbackOtaFirmwareStatus({
      clients,
      batteryId: requiredOption(args, "battery-id"),
      ...(generation ? { generation } : {}),
      ...(option(args, "operation-id") ? { operationId: option(args, "operation-id")! } : {}),
      ...(option(args, "confirm") ? { confirmationToken: option(args, "confirm")! } : {}),
      ...(option(args, "history-file") ? { historyFile: option(args, "history-file")! } : {}),
    })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  throw new Error("firmware status 只支持 set/设置、history/历史 或 rollback/回滚")
}

async function runOta(args: ParsedArgs): Promise<void> {
  const subcommand = normalizedSubcommand(args.positionals[1])
  if (subcommand === "version" || subcommand === "get") {
    validateOptions(args, ["battery-id", "generation", "json"])
    if (args.positionals.length > 2) throw new Error(`多余参数: ${args.positionals.slice(2).join(" ")}`)
    const clients = await createClients(args)
    const generation = parseGeneration(option(args, "generation"))
    const result = await queryOtaVersion({ clients, batteryId: requiredOption(args, "battery-id"), ...(generation ? { generation } : {}) })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (subcommand === "firmware" && normalizedSubcommand(args.positionals[2]) === "status") {
    return runOtaFirmwareStatus(args)
  }
  if (subcommand === "firmware" && normalizedSubcommand(args.positionals[2]) === "current") {
    validateOptions(args, ["battery-id", "generation", "json"])
    if (args.positionals.length > 3) throw new Error(`多余参数: ${args.positionals.slice(3).join(" ")}`)
    const clients = await createClients(args)
    const generation = parseGeneration(option(args, "generation"))
    const result = await queryCurrentOtaFirmware({ clients, batteryId: requiredOption(args, "battery-id"), ...(generation ? { generation } : {}) })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  if (subcommand === "firmware" || subcommand === "list") {
    const action = subcommand === "firmware" ? normalizedSubcommand(args.positionals[2]) : "list"
    if (action !== "list") throw new Error("battery ota firmware 只支持 list/列表")
    validateOptions(args, ["battery-id", "generation", "firmware-version", "firmware-name", "detail", "json"])
    if (args.positionals.length > 3) throw new Error(`多余参数: ${args.positionals.slice(3).join(" ")}`)
    const clients = await createClients(args)
    const generation = parseGeneration(option(args, "generation"))
    const result = await listOtaFirmware({
      clients, batteryId: requiredOption(args, "battery-id"), ...(generation ? { generation } : {}),
      ...(option(args, "firmware-version") ? { firmwareVersion: option(args, "firmware-version")! } : {}),
      ...(option(args, "firmware-name") ? { firmwareName: option(args, "firmware-name")! } : {}),
    })
    const output = args.options.has("detail") ? result : { batteryId: result.batteryId, generation: result.generation, total: result.total, firmwares: result.firmwares.map(compactFirmware) }
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
    return
  }
  if (subcommand === "inspect") {
    validateOptions(args, ["battery-id", "generation", "firmware-id", "firmware-version", "firmware-name", "allow-downgrade", "preflight-minutes", "min-data-count", "detail", "json"])
    if (args.positionals.length > 2) throw new Error(`多余参数: ${args.positionals.slice(2).join(" ")}`)
    const clients = await createClients(args)
    const generation = parseGeneration(option(args, "generation"))
    const firmwareSelector = firmwareSelectorOptions(args)
    const preflightMinutes = positiveIntegerOption(args, "preflight-minutes")
    const minDataCount = positiveIntegerOption(args, "min-data-count")
    const result = await inspectOtaPreconditions({
      clients, batteryId: requiredOption(args, "battery-id"), ...firmwareSelector, ...(generation ? { generation } : {}),
      ...(preflightMinutes !== undefined ? { preflightMinutes } : {}),
      ...(minDataCount !== undefined ? { minDataCount } : {}),
      ...(args.options.has("allow-downgrade") ? { allowDowngrade: true } : {}),
    })
    const output = args.options.has("detail") ? result : { ...result.preflight, firmware: compactFirmware(result.firmware) }
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
    return
  }
  if (subcommand === "start") {
    validateOptions(args, ["battery-id", "generation", "firmware-id", "firmware-version", "firmware-name", "allow-downgrade", "confirm", "preflight-minutes", "min-data-count", "detail", "json"])
    if (args.positionals.length > 2) throw new Error(`多余参数: ${args.positionals.slice(2).join(" ")}`)
    const clients = await createClients(args)
    const generation = parseGeneration(option(args, "generation"))
    const firmwareSelector = firmwareSelectorOptions(args)
    const preflightMinutes = positiveIntegerOption(args, "preflight-minutes")
    const minDataCount = positiveIntegerOption(args, "min-data-count")
    const result = await startOtaUpgrade({
      clients, batteryId: requiredOption(args, "battery-id"), ...firmwareSelector, ...(generation ? { generation } : {}),
      ...(option(args, "confirm") ? { confirmationToken: option(args, "confirm")! } : {}),
      ...(preflightMinutes !== undefined ? { preflightMinutes } : {}),
      ...(minDataCount !== undefined ? { minDataCount } : {}),
      ...(args.options.has("allow-downgrade") ? { allowDowngrade: true } : {}),
    })
    const output = result.phase === "PREVIEW" && !args.options.has("detail") ? { ...result, targetFirmware: compactFirmware(result.targetFirmware) } : result
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
    return
  }
  if (subcommand === "result") {
    validateOptions(args, ["battery-id", "generation", "session-id", "firmware-id", "target-version", "json"])
    if (args.positionals.length > 2) throw new Error(`多余参数: ${args.positionals.slice(2).join(" ")}`)
    const clients = await createClients(args)
    const generation = parseGeneration(option(args, "generation"))
    const sessionIdText = option(args, "session-id")
    const sessionId = sessionIdText === undefined ? undefined : Number(sessionIdText)
    if (sessionIdText !== undefined && (!Number.isInteger(sessionId) || sessionId! <= 0)) throw new Error("--session-id 必须是正整数")
    const result = await queryOtaResult({
      clients, batteryId: requiredOption(args, "battery-id"), ...(generation ? { generation } : {}), ...(sessionId !== undefined ? { sessionId } : {}),
      ...(option(args, "firmware-id") ? { firmwareId: option(args, "firmware-id")! } : {}), ...(option(args, "target-version") ? { targetVersion: option(args, "target-version")! } : {}),
    })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  throw new Error("battery ota 只支持 version、firmware list/status、inspect、start 或 result")
}

async function runBattery(args: ParsedArgs): Promise<void> {
  const area = normalizedSubcommand(args.positionals[1])
  if (!area) throw new Error("battery 需要子命令：status、ready、mode、command、parameter、export 或 ota")
  const nested = { ...args, positionals: [area, ...args.positionals.slice(2)] }
  if (area === "status") return runStatus(nested, true)
  if (area === "ready") return runCommandReady(withJsonOutput(nested))
  if (area === "mode") return runMode(normalizedSubcommand(nested.positionals[1]) === "set" ? withDefaultFourG(nested) : nested)
  if (area === "ota") return runOta(nested)
  if (area === "command") {
    const verb = normalizedSubcommand(nested.positionals[1])
    const commandArgs = verb === "list" || verb === "send" || verb === "result"
      ? nested
      : { ...nested, positionals: ["command", "send", ...nested.positionals.slice(1)] }
    return runCommand(verb === "result" ? commandArgs : withDefaultFourG(commandArgs), true)
  }
  if (area === "parameter") {
    const verb = normalizedSubcommand(nested.positionals[1])
    const parameterArgs = verb === "get" || verb === "read" || verb === "set" || verb === "write"
      ? withDefaultFourG(nested)
      : nested
    return runParameter(parameterArgs, true)
  }
  if (area === "export") {
    const type = nested.positionals[1]
    if (!type) throw new Error("battery export 缺少类型；例如 realtime")
    if (type === "realtime") return runRealtime(nested)
    return runGenericExport(nested, type)
  }
  throw new Error("battery 只支持 status、ready、mode、command、parameter、export 或 ota")
}

async function runBatch(args: ParsedArgs): Promise<void> {
  const area = normalizedSubcommand(args.positionals[1])
  if (!area) throw new Error("batch 需要 status、command、parameter 或 export")
  const selectedChannel = parseChannel(option(args, "channel"), false)
  if (selectedChannel && selectedChannel !== "4g") throw new Error("批量控制与参数操作仅支持 4g；蓝牙只支持单电池任务")
  const clients = await createClients(args)
  const batteryIds = await collectBatteryIds(args)
  if (area === "status") {
    validateOptions(args, ["battery-id", "battery-file", "channel", "json"])
    if (args.positionals.length > 2) throw new Error(`多余参数: ${args.positionals.slice(2).join(" ")}`)
    const result = await queryBatchBatteryStatus({ clients, batteryIds })
    process.stdout.write(`${JSON.stringify({ targets: result.targets, results: result.results.map((item) => item.ok && item.status ? { batteryId: item.batteryId, generation: item.generation, ok: true, status: compactStatus(item.status, item.readiness) } : item) }, null, 2)}\n`)
    return
  }
  if (area === "command") {
    const action = normalizedSubcommand(args.positionals[2])
    const implicit = action !== "send"
    validateOptions(args, ["battery-id", "battery-file", "channel", "value", "confirm", "json"])
    const command = implicit ? args.positionals[2] : args.positionals[3]
    if (!command) throw new Error("batch command send 缺少命令名")
    const maxPositionals = implicit ? 3 : 4
    if (args.positionals.length > maxPositionals) throw new Error(`多余参数: ${args.positionals.slice(maxPositionals).join(" ")}`)
    const result = await controlBatteryBatch({ clients, batteryIds, command, ...(option(args, "value") !== undefined ? { value: option(args, "value")! } : {}), ...(option(args, "confirm") ? { confirmationToken: option(args, "confirm")! } : {}) })
    process.stdout.write(`${JSON.stringify(agentOperationOutput(result), null, 2)}\n`)
    return
  }
  if (area === "parameter") {
    const action = normalizedSubcommand(args.positionals[2])
    if (action === "read" || action === "get") {
      validateOptions(args, ["battery-id", "battery-file", "channel", "json", "detail"])
      const selector = args.positionals[3]
      if (!selector || args.positionals.length > 4) throw new Error("batch parameter read 需要一个参数名称、别名或 ID")
      const result = await readBatteryParameterBatch({ clients, batteryIds, selector })
      process.stdout.write(`${JSON.stringify({ targets: result.targets, results: result.results.map((item) => item.ok && item.result ? { batteryId: item.batteryId, ok: true, result: compactParameterResult(item.result) } : item) }, null, 2)}\n`)
      return
    }
    if (action === "write" || action === "set") {
      validateOptions(args, ["battery-id", "battery-file", "channel", "confirm", "json"])
      const selector = args.positionals[3], value = args.positionals[4]
      if (!selector || value === undefined || args.positionals.length > 5) throw new Error("batch parameter write 需要 <参数名或ID> <新值>")
      const result = await writeBatteryParameterBatch({ clients, batteryIds, selector, value, ...(option(args, "confirm") ? { confirmationToken: option(args, "confirm")! } : {}) })
      process.stdout.write(`${JSON.stringify(agentOperationOutput(result), null, 2)}\n`)
      return
    }
    throw new Error("batch parameter 只支持 read/get 或 write/set")
  }
  if (area === "export") {
    const type = args.positionals[2]
    validateOptions(args, ["battery-id", "battery-file", "channel", "output-dir", "start", "end", "hours", "json"])
    if (type !== "realtime") throw new Error("batch export 当前仅支持 realtime")
    if (args.positionals.length > 3) throw new Error(`多余参数: ${args.positionals.slice(3).join(" ")}`)
    const outputDir = requiredOption(args, "output-dir")
    const hours = parseHours(option(args, "hours"))
    const result = await exportBatteryRealtimeBatch({ clients, batteryIds, outputDir, ...(option(args, "start") ? { start: option(args, "start")! } : {}), ...(option(args, "end") ? { end: option(args, "end")! } : {}), ...(hours !== undefined ? { hours } : {}) })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  throw new Error("batch 只支持 status、command、parameter 或 export")
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.options.has("version")) {
    process.stdout.write(`${VERSION}\n`)
    return
  }
  if (args.options.has("help") || args.positionals.length === 0) {
    process.stdout.write(help())
    return
  }

  const command = TOP_LEVEL_ALIASES[args.positionals[0]!] ?? args.positionals[0]!
  if (command === "export") {
    const type = args.positionals[1]
    if (!type) throw new Error("export 命令缺少类型；使用 kdb --help 查看可选值")
    if (args.positionals.length > 2) throw new Error(`多余参数: ${args.positionals.slice(2).join(" ")}`)
    if (type === "realtime") await runRealtime(args)
    else await runGenericExport(args, type)
    return
  }
  if (command === "status") {
    if (args.positionals.length > 1) throw new Error(`多余参数: ${args.positionals.slice(1).join(" ")}`)
    await runStatus(args)
    return
  }
  if (command === "command-ready" || command === "ready") {
    if (args.positionals.length > 1) throw new Error(`多余参数: ${args.positionals.slice(1).join(" ")}`)
    await runCommandReady(args)
    return
  }
  if (command === "command") {
    await runCommand(args)
    return
  }
  if (command === "parameter") {
    await runParameter(args)
    return
  }
  if (command === "mode") {
    await runMode(args)
    return
  }
  if (command === "battery") {
    await runBattery(args)
    return
  }
  if (command === "batch") {
    await runBatch(args)
    return
  }
  if (command === "ota") {
    await runOta({ ...args, positionals: ["ota", ...args.positionals.slice(1)] })
    return
  }
  throw new Error(`未知命令: ${command}；使用 kdb --help 查看帮助`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`错误: ${message}\n`)
  process.exitCode = 1
})
