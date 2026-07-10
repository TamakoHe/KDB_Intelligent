#!/usr/bin/env node

import process from "node:process"
import {
  createKdbClients,
  exportBatteryRealtimeData,
  exportExcel,
  queryBatteryCommandReadiness,
  queryBatteryStatusById,
  resolveTimeRange,
  type ExportType,
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
const BOOLEAN_OPTIONS = new Set(["help", "version", "json"])
const ALIASES: Record<string, string> = {
  b: "battery-id",
  g: "generation",
  o: "output",
  H: "hours",
  h: "help",
}

type ParsedArgs = { positionals: string[]; options: Map<string, string[]> }

function help(): string {
  return `KDB 电池数据 SDK/CLI

用法:
  kdb export realtime --battery-id <编号> [时间选项] [--output <文件>]
  kdb export <类型> [--generation gen2|gen3] [筛选选项]
  kdb status --battery-id <编号>
  kdb command-ready --battery-id <编号>

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

示例:
  kdb export realtime -b 8F9AE708 --start "2026-07-01 00:00:00" --end "2026-07-02 00:00:00"
  kdb export realtime -b 62413828 --hours 6 -o out/realtime.xlsx
  kdb export nettyLog -b 8F9AE708 --param beginCreateTime="2026-07-01 00:00:00"
  kdb export batteryBase --generation gen3 --query batteryStatus=1
  kdb status -b 62413828
  kdb command-ready -b 62413828
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

async function runStatus(args: ParsedArgs): Promise<void> {
  validateOptions(args, ["battery-id", "generation", "json"])
  const batteryId = requiredOption(args, "battery-id")
  const clients = await createClients(args)
  const generation = parseGeneration(option(args, "generation"))
  const result = await queryBatteryStatusById({
    clients,
    batteryId,
    ...(generation ? { generation } : {}),
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
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

  const command = args.positionals[0]
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
  throw new Error(`未知命令: ${command}；使用 kdb --help 查看帮助`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`错误: ${message}\n`)
  process.exitCode = 1
})
