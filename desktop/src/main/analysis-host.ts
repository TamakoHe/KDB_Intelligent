import { randomUUID } from "node:crypto"
import { createInterface } from "node:readline"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { app } from "electron"
import { spawn } from "node:child_process"
import { z } from "zod"
import type { AppSettings, ResultCard } from "../shared.js"
import { getCore, getKdbClients } from "./kdb-core.js"
import { analysisRequestSchema, type AnalysisHostMethod, type AnalysisRequest, type AnalysisWorkerMessage, type AnalysisWorkerRun } from "./analysis-contract.js"
import { validateAnalysisScript } from "./analysis-security.js"

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

export function createAnalysisPreview(request: AnalysisRequest): { card: ResultCard; actionId: string } {
  const parsed = analysisRequestSchema.safeParse(request)
  if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.message).join("；"))
  validateAnalysisScript(parsed.data.script)
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
  try {
    const result = await runWorker(request, settings)
    return { id: randomUUID(), kind: "analysis", title: "高级分析完成", summary: `${request.purpose}。`, data: asRecord(result) }
  } catch (error) {
    return { id: randomUUID(), kind: "error", title: "高级分析失败", summary: error instanceof Error ? error.message : String(error) }
  }
}

export function cancelAnalysisAction(actionId: string): void {
  pendingAnalysis.delete(actionId)
}

async function runWorker(request: AnalysisRequest, settings: AppSettings): Promise<unknown> {
  const core = await getCore()
  const clients = await getKdbClients(settings)
  const worker = spawn(process.execPath, [workerEntry(), "--analysis-worker"], {
    cwd: app.getPath("userData"),
    env: { ELECTRON_RUN_AS_NODE: "1", NODE_ENV: "production" },
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  })
  const output = createInterface({ input: worker.stdout, crlfDelay: Infinity })
  const errors: string[] = []
  worker.stderr.on("data", (chunk) => errors.push(String(chunk)))
  const budget: Budget = { calls: 0, rows: 0 }
  const resultPromise = new Promise<unknown>((resolve, reject) => {
    output.on("line", (line) => {
      let message: AnalysisWorkerMessage
      try { message = JSON.parse(line) as AnalysisWorkerMessage } catch { reject(new Error("分析 Worker 返回非法 JSON")); return }
      if (message.type === "request") {
        void handleHostRequest({ core, clients, request, settings, budget, method: message.method, args: message.args }).then(
          (data) => worker.stdin.write(`${JSON.stringify({ type: "response", requestId: message.requestId, ok: true, data })}\n`),
          (error) => worker.stdin.write(`${JSON.stringify({ type: "response", requestId: message.requestId, ok: false, error: error instanceof Error ? error.message : String(error) })}\n`),
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
  settings: AppSettings
  budget: Budget
  method: AnalysisHostMethod
  args: unknown
}): Promise<unknown> {
  args.budget.calls++
  if (args.budget.calls > MAX_CALLS) throw new Error(`分析调用次数超过 ${MAX_CALLS} 次限制`)
  const permission = args.method === "read.batteries" ? "read.batteryBase" : args.method === "read.latestStatus" ? "read.latestStatus" : args.method === "read.history" ? "read.history" : "export.realtime"
  if (!args.request.permissions.includes(permission as never)) throw new Error(`分析脚本未申请 ${permission} 权限`)
  if (args.method === "read.batteries") {
    const input = batteriesArgsSchema.parse(args.args)
    const result = await args.core.listAnalysisBatteries({ clients: args.clients, ...input, source: input.source ?? args.request.source, limit: input.limit ?? MAX_BATTERIES })
    args.budget.rows += result.rows.length
    if (args.budget.rows > MAX_ROWS) throw new Error(`分析读取行数超过 ${MAX_ROWS} 条限制`)
    return result
  }
  if (args.method === "read.history") {
    const input = historyArgsSchema.parse(args.args)
    const generation = input.generation ?? inferGeneration(input.batteryId, args.clients.config)
    const result = await args.core.listAnalysisHistory({ clients: args.clients, ...input, generation, source: input.source ?? args.request.source, limit: input.limit ?? MAX_ROWS })
    args.budget.rows += result.rows.length
    if (args.budget.rows > MAX_ROWS) throw new Error(`分析读取行数超过 ${MAX_ROWS} 条限制`)
    return result
  }
  if (args.method === "read.latestStatus") {
    const input = latestStatusArgsSchema.parse(args.args)
    const results: unknown[] = []
    for (const batteryId of [...new Set(input.batteryIds.map((value) => value.toUpperCase()))]) {
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
    const outputPath = path.join(outputDir, `${batteryId}-realtime.xlsx`)
    const result = await args.core.exportBatteryRealtimeData({ clients: args.clients, batteryId, start: input.start, end: input.end, source, outputPath, maxRows: args.settings.exportMaxRows })
    rows += Number(result.rowCount ?? 0)
    results.push(result)
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
