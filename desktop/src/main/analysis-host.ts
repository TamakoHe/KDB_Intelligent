import { randomUUID } from "node:crypto"
import { createInterface } from "node:readline"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { app } from "electron"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { z } from "zod"
import type { AnalysisProgress, AppSettings, ResultCard } from "../shared.js"
import { getCore, getKdbClients } from "./kdb-core.js"
import { analysisRequestSchema, type AnalysisHostMethod, type AnalysisRequest, type AnalysisWorkerMessage, type AnalysisWorkerRun } from "./analysis-contract.js"
import { validateAnalysisIntent, validateAnalysisScript } from "./analysis-security.js"

const MAX_ROWS = 20_000
const MAX_BATTERIES = 2_000
const MAX_CALLS = 200
const sourceSchema = z.enum(["api", "local", "auto"])
const ANALYSIS_FIELDS = new Set([
  "batteryId", "generation", "serialNumber", "batteryDataId", "batteryType", "batteryStatus", "faultStatus", "chargeDischargeStatus", "workingModeStatus", "systemOperatingStatus",
  "lte4gStatus", "bluetoothStatus", "batteryVersion", "firmwareVersion", "appVersion", "warrantyStatus", "agentName", "batteryModelName", "batteryLabel", "useTime", "storageTime", "deliveryTime", "jwProvince", "jwCity", "jwArea", "jwVillage",
  "updateTime", "createTime", "logTime", "current", "totalBatteryVoltage", "residualElectricQuantity", "cellVoltage1", "cellVoltage2", "cellVoltage3", "cellVoltage4", "cellVoltage5", "cellVoltage6", "cellVoltage7", "cellVoltage8", "cellTemperature", "boxTemperature",
  "mosTemperature", "ptcTemperature1", "ptcTemperature2", "dischargeMosTemperature", "chargeMosTemperature", "heatingFilmTemperature",
  "motherboardTemperature", "positivePoleTemperature", "negativePoleTemperature", "msgId", "msgType", "msgStatus",
])
const filterSchema = z.object({
  field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,50}$/).refine((field) => ANALYSIS_FIELDS.has(field), "不支持的分析字段"),
  operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in"]),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()])).min(1).max(100)]),
})
const batteriesArgsSchema = z.object({
  generation: z.enum(["gen2", "gen3"]).optional(),
  source: sourceSchema.optional(),
  filters: z.array(filterSchema).max(20).optional(),
  start: z.string().max(40).optional(),
  end: z.string().max(40).optional(),
  limit: z.number().int().min(1).max(MAX_BATTERIES).optional(),
})
const historyArgsSchema = z.object({
  batteryId: z.string().regex(/^[0-9A-Fa-f]{8}$/),
  generation: z.enum(["gen2", "gen3"]).optional(),
  source: sourceSchema.optional(),
  start: z.string().min(1).max(40),
  end: z.string().min(1).max(40),
  fields: z.array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,50}$/).refine((field) => ANALYSIS_FIELDS.has(field), "不支持的分析字段")).max(80).optional(),
  filters: z.array(filterSchema).max(20).optional(),
  limit: z.number().int().min(1).max(MAX_ROWS).optional(),
})
const latestStatusArgsSchema = z.object({
  batteryIds: z.array(z.string().regex(/^[0-9A-Fa-f]{8}$/)).min(1).max(100),
  generation: z.enum(["gen2", "gen3"]).optional(),
  source: sourceSchema.optional(),
})
const exportArgsSchema = z.object({
  batteryIds: z.array(z.string().regex(/^[0-9A-Fa-f]{8}$/)).min(1).max(MAX_BATTERIES),
  source: sourceSchema.optional(),
  start: z.string().min(1).max(40),
  end: z.string().min(1).max(40),
  maxRows: z.number().int().min(1).max(100_000).optional(),
})

type Budget = { calls: number; rows: number }
const pendingAnalysis = new Map<string, AnalysisRequest>()
const runningAnalyses = new Map<string, { worker?: ChildProcessWithoutNullStreams; cancelRequested: boolean }>()
const progressListeners = new Set<(progress: AnalysisProgress) => void>()

export function onAnalysisProgress(listener: (progress: AnalysisProgress) => void): () => void {
  progressListeners.add(listener)
  return () => progressListeners.delete(listener)
}

function emitAnalysisProgress(progress: AnalysisProgress): void {
  for (const listener of progressListeners) listener(progress)
}

export function createAnalysisPreview(request: AnalysisRequest): { card: ResultCard; actionId: string } {
  const parsed = analysisRequestSchema.safeParse(request)
  if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.message).join("；"))
  validateAnalysisScript(parsed.data.script)
  validateAnalysisIntent(parsed.data.purpose, parsed.data.script)
  const actionId = randomUUID()
  pendingAnalysis.set(actionId, parsed.data)
  const card: ResultCard = {
    id: randomUUID(),
    kind: "analysis-preview",
    title: "高级分析预览",
    summary: `${parsed.data.purpose}。脚本仅可访问受控只读 API，点击“运行分析”后才会执行。`,
    data: {
      purpose: parsed.data.purpose,
      source: parsed.data.source,
      permissions: parsed.data.permissions,
      script: parsed.data.script,
      limits: { maxBatteries: MAX_BATTERIES, maxRows: MAX_ROWS, timeoutSeconds: 120 },
    },
    actionId,
    actionLabel: "运行分析",
  }
  return { card, actionId }
}

export async function runAnalysisAction(actionId: string, settings: AppSettings): Promise<ResultCard> {
  const request = pendingAnalysis.get(actionId)
  if (!request) return { id: randomUUID(), kind: "error", title: "分析已失效", summary: "未找到该分析预览；请重新发起请求。" }
  pendingAnalysis.delete(actionId)
  const running = { cancelRequested: false }
  runningAnalyses.set(actionId, running)
  emitAnalysisProgress({ actionId, phase: "starting", message: "正在启动隔离分析 Worker…" })
  try {
    const result = await runWorker(actionId, request, settings, running)
    const data = asRecord(result)
    const warnings = Array.isArray(data.warnings) ? data.warnings.filter((value): value is string => typeof value === "string") : []
    const summary = warnings.length > 0
      ? `${request.purpose}。部分代际查询失败，结果不保证全量：${warnings.join("；")}`
      : `${request.purpose}。`
    emitAnalysisProgress({ actionId, phase: "completed", message: "高级分析已完成。" })
    return { id: randomUUID(), kind: "analysis", title: "高级分析完成", summary, data }
  } catch (error) {
    if (running.cancelRequested) {
      emitAnalysisProgress({ actionId, phase: "cancelled", message: "高级分析已停止。" })
      return { id: randomUUID(), kind: "data", title: "高级分析已停止", summary: "已停止继续扫描；已完成的读取或导出不会被回滚。", data: { cancelled: true } }
    }
    emitAnalysisProgress({ actionId, phase: "failed", message: error instanceof Error ? error.message : String(error) })
    return { id: randomUUID(), kind: "error", title: "高级分析失败", summary: error instanceof Error ? error.message : String(error) }
  } finally {
    runningAnalyses.delete(actionId)
  }
}

export function cancelAnalysisAction(actionId: string): void {
  pendingAnalysis.delete(actionId)
  const running = runningAnalyses.get(actionId)
  if (running) {
    running.cancelRequested = true
    emitAnalysisProgress({ actionId, phase: "cancelled", message: "正在停止分析 Worker…" })
    running.worker?.kill()
  }
}

async function runWorker(actionId: string, request: AnalysisRequest, settings: AppSettings, running: { worker?: ChildProcessWithoutNullStreams; cancelRequested: boolean }): Promise<unknown> {
  const core = await getCore()
  const clients = await getKdbClients(settings)
  const worker = spawn(process.execPath, [workerEntry(), "--analysis-worker"], {
    cwd: app.getPath("userData"),
    env: { ELECTRON_RUN_AS_NODE: "1", NODE_ENV: "production" },
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  })
  running.worker = worker
  const output = createInterface({ input: worker.stdout, crlfDelay: Infinity })
  const errors: string[] = []
  worker.stderr.on("data", (chunk) => errors.push(String(chunk)))
  const budget: Budget = { calls: 0, rows: 0 }
  const resultPromise = new Promise<unknown>((resolve, reject) => {
    output.on("line", (line) => {
      let message: AnalysisWorkerMessage
      try { message = JSON.parse(line) as AnalysisWorkerMessage } catch { reject(new Error("分析 Worker 返回非法 JSON")); return }
      if (message.type === "request") {
        void handleHostRequest({ actionId, core, clients, request, settings, budget, method: message.method, args: message.args, isCancelled: () => running.cancelRequested }).then(
          (data) => { if (!running.cancelRequested && worker.stdin.writable) worker.stdin.write(`${JSON.stringify({ type: "response", requestId: message.requestId, ok: true, data })}\n`) },
          (error) => { if (!running.cancelRequested && worker.stdin.writable) worker.stdin.write(`${JSON.stringify({ type: "response", requestId: message.requestId, ok: false, error: error instanceof Error ? error.message : String(error) })}\n`) },
        )
      } else if (message.type === "result") resolve(message.value)
      else if (message.type === "error") reject(new Error(message.error))
    })
    worker.once("error", reject)
    worker.once("close", (code) => {
      if (code !== 0) reject(new Error(errors.join(" ").trim() || `分析 Worker 退出，代码 ${code ?? -1}`))
    })
  })
  const timeout = setTimeout(() => worker.kill(), 120_000)
  try {
    const runMessage: AnalysisWorkerRun = { type: "run", request }
    if (running.cancelRequested) throw new Error("分析已停止")
    worker.stdin.write(`${JSON.stringify(runMessage)}\n`)
    const result = await resultPromise
    const json = JSON.stringify(result)
    if (json.length > 10 * 1024 * 1024) throw new Error("分析结果超过 10 MB 限制")
    return result
  } finally {
    clearTimeout(timeout)
    output.close()
    if (!worker.killed) worker.kill()
  }
}

async function handleHostRequest(args: {
  core: Record<string, any>
  clients: any
  request: AnalysisRequest
  actionId: string
  settings: AppSettings
  budget: Budget
  method: AnalysisHostMethod
  args: unknown
  isCancelled: () => boolean
}): Promise<unknown> {
  if (args.isCancelled()) throw new Error("分析已停止")
  args.budget.calls++
  if (args.budget.calls > MAX_CALLS) throw new Error(`分析调用次数超过 ${MAX_CALLS} 次限制`)
  const permission = args.method === "read.batteries" ? "read.batteryBase" : args.method === "read.latestStatus" ? "read.latestStatus" : args.method === "read.history" ? "read.history" : "export.realtime"
  if (!args.request.permissions.includes(permission as never)) throw new Error(`分析脚本未申请 ${permission} 权限`)
  if (args.method === "read.batteries") {
    emitAnalysisProgress({ actionId: args.actionId, phase: "reading", method: args.method, message: "正在读取候选电池基础表…" })
    const input = batteriesArgsSchema.parse(args.args)
    const result = await args.core.listAnalysisBatteries({ clients: args.clients, ...input, source: input.source ?? args.request.source, limit: input.limit ?? MAX_BATTERIES })
    if (args.isCancelled()) throw new Error("分析已停止")
    args.budget.rows += result.rows.length
    if (args.budget.rows > MAX_ROWS) throw new Error(`分析读取行数超过 ${MAX_ROWS} 条限制`)
    emitAnalysisProgress({ actionId: args.actionId, phase: "reading", method: args.method, message: `候选电池读取完成：${result.rows.length} 条。`, scanned: result.rows.length, total: input.limit ?? MAX_BATTERIES })
    return result
  }
  if (args.method === "read.history") {
    const input = historyArgsSchema.parse(args.args)
    emitAnalysisProgress({ actionId: args.actionId, phase: "reading", method: args.method, currentBatteryId: input.batteryId.toUpperCase(), message: `正在读取电池 ${input.batteryId.toUpperCase()} 的历史…` })
    const generation = input.generation ?? inferGeneration(input.batteryId, args.clients.config)
    const result = await args.core.listAnalysisHistory({ clients: args.clients, ...input, generation, source: input.source ?? args.request.source, limit: input.limit ?? MAX_ROWS })
    if (args.isCancelled()) throw new Error("分析已停止")
    args.budget.rows += result.rows.length
    if (args.budget.rows > MAX_ROWS) throw new Error(`分析读取行数超过 ${MAX_ROWS} 条限制`)
    emitAnalysisProgress({ actionId: args.actionId, phase: "reading", method: args.method, currentBatteryId: input.batteryId.toUpperCase(), message: `电池 ${input.batteryId.toUpperCase()} 历史读取完成：${result.rows.length} 条。`, scanned: args.budget.calls, matched: result.rows.length })
    return result
  }
  if (args.method === "read.latestStatus") {
    const input = latestStatusArgsSchema.parse(args.args)
    const results: unknown[] = []
    for (const batteryId of [...new Set(input.batteryIds.map((value) => value.toUpperCase()))]) {
      if (args.isCancelled()) throw new Error("分析已停止")
      emitAnalysisProgress({ actionId: args.actionId, phase: "reading", method: args.method, currentBatteryId: batteryId, message: `正在读取电池 ${batteryId} 的最新状态…` })
      const generation = input.generation ?? inferGeneration(batteryId, args.clients.config)
      const result = await args.core.queryBatteryStatusById({ clients: args.clients, batteryId, generation, source: input.source ?? args.request.source })
      results.push(result)
      args.budget.rows++
      if (args.budget.rows > MAX_ROWS) throw new Error(`分析读取行数超过 ${MAX_ROWS} 条限制`)
    }
    return { rows: results, source: input.source ?? args.request.source }
  }
  const input = exportArgsSchema.parse(args.args)
  const source = input.source ?? args.request.source
  const outputDir = path.join(app.getPath("documents"), "KDB Copilot Exports", `analysis-${Date.now()}-${randomUUID().slice(0, 8)}`)
  await mkdir(outputDir, { recursive: true })
  const results: unknown[] = []
  let rows = 0
  for (const batteryId of [...new Set(input.batteryIds.map((value) => value.toUpperCase()))]) {
    if (args.isCancelled()) throw new Error("分析已停止")
    emitAnalysisProgress({ actionId: args.actionId, phase: "exporting", method: "export.realtime", currentBatteryId: batteryId, message: `正在导出电池 ${batteryId}…`, total: input.batteryIds.length })
    const outputPath = path.join(outputDir, `${batteryId}-realtime.xlsx`)
    const result = await args.core.exportBatteryRealtimeData({ clients: args.clients, batteryId, start: input.start, end: input.end, source, outputPath, maxRows: args.settings.exportMaxRows })
    rows += Number(result.rowCount ?? 0)
    results.push(result)
    emitAnalysisProgress({ actionId: args.actionId, phase: "exporting", currentBatteryId: batteryId, message: `电池 ${batteryId} 导出完成：${result.rowCount ?? 0} 条。`, exportedRows: rows, total: input.batteryIds.length })
    if (rows >= MAX_ROWS) break
  }
  args.budget.rows += rows
  if (args.budget.rows > MAX_ROWS) throw new Error(`分析导出行数超过 ${MAX_ROWS} 条限制`)
  const actualSources = [...new Set(results.map((item) => item && typeof item === "object" && "source" in item ? String((item as { source?: unknown }).source) : source))]
  return { outputDir, files: results, rowCount: rows, source: actualSources.length === 1 ? actualSources[0] : "mixed", requestedSource: source, maxRows: args.settings.exportMaxRows }
}

function inferGeneration(batteryId: string, config: any): "gen2" | "gen3" {
  const normalized = batteryId.toUpperCase()
  if (config.routing.gen2_prefixes.some((prefix: string) => normalized.startsWith(prefix.toUpperCase()))) return "gen2"
  return "gen3"
}

function workerEntry(): string {
  return path.join(app.getAppPath(), "out", "main", "analysis-worker.js")
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : { result: value }
}
