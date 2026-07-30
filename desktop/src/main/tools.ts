import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import path from "node:path"
import { app } from "electron"
import { z } from "zod"
import type { AppSettings, ResultCard } from "../shared.js"
import { analysisRequestSchema } from "./analysis-contract.js"
import { cancelAnalysisAction, createAnalysisPreview, runAnalysisAction } from "./analysis-host.js"
import { createScanPreview, pauseScanTask, resumeScanTask, runScanAction, stopScanTask } from "./scan-host.js"
import { createSqlPreview, runSqlAction } from "./sql-expert.js"
import { scanRequestSchema, sqlRequestSchema } from "./scan-contract.js"

type PlannedStep = { id: string; purpose: string; argv: string[] }
type PendingAction = { argv: string[]; confirmationToken: string }
type CliStepResult = { id: string; purpose: string; argv: string[]; ok: boolean; exitCode: number; attempts: number; data?: unknown; error?: string }

const pendingActions = new Map<string, PendingAction>()
const safeStepId = z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/)
const cliPlanSchema = z.object({
  steps: z.array(z.object({ id: safeStepId, purpose: z.string().trim().min(1).max(160), argv: z.array(z.string().min(1).max(300)).min(1).max(40) })).min(1).max(20),
})

const BLOCKED_OPTIONS = new Set(["--root-dir", "--battery-file", "--history-file", "--confirm"])
const MODEL_OUTPUT_OPTIONS = new Set(["--output", "-o", "--output-dir", "--max-rows"])
const TOP_LEVEL = new Set(["battery", "status", "ready", "command-ready", "command", "parameter", "mode", "batch", "export", "ota"])

export const modelTools = [
  definition("run_kdb_cli_plan", "按 KDB CLI 技能执行一个受控命令计划。只传 kdb 后的 argv 数组，不要传 npm/node/shell。复杂需求可在一个计划内给出多个步骤；写操作只会产生预览，绝不能加入 --confirm。", cliPlanSchema),
  definition("run_kdb_analysis", "为动态筛选和跨电池只读分析生成受限 JavaScript 预览。read.batteries 只读当前基础表快照，不是历史故障查询；read.history 必须指定明确电池 ID，不能隐式扫描所有电池历史分表。用户要求所有历史故障电池但未给 ID 清单时先说明限制，不要生成误导脚本。脚本必须定义 async function main(kdb)，只能调用受控 kdb.read/kdb.export API；不要生成 SQL、Shell、Node、npm、OpenClaw 或文件路径。桌面端会显示脚本并等待用户点击运行分析。", analysisRequestSchema),
  definition("run_kdb_scan", "创建可恢复的全库历史扫描预览。用于动态筛选所有电池、跨代际历史分表和长时间任务；普通 CLI 或 run_kdb_analysis 能完成时不要使用。source 可为 api/local/both；模型只提交时间范围和白名单筛选条件，不得生成 SQL、Shell、文件路径或控制命令。用户点击开始扫描后，桌面端会分批执行并显示进度。", scanRequestSchema),
  definition("run_kdb_sql", "创建专家只读 SQL 预览，仅用于用户明确要求复杂本地历史库查询的场景。只能生成单条 SELECT 或 WITH SELECT；不得生成写操作、文件操作、注释、多语句、系统外 schema 或控制/OTA 命令。执行前桌面端显示 SQL 和风险评估并等待用户点击。", sqlRequestSchema),
]

export async function executeTool(name: string, rawArgs: unknown, settings: AppSettings): Promise<{ model: unknown; cards: ResultCard[] }> {
  if (name === "run_kdb_analysis") {
    const parsed = analysisRequestSchema.safeParse(rawArgs)
    if (!parsed.success) return toolError("高级分析请求无效", parsed.error.issues.map((item) => item.message).join("；"))
    try {
      const preview = createAnalysisPreview(parsed.data)
      return { model: { phase: "preview", actionId: preview.actionId, purpose: parsed.data.purpose, source: parsed.data.source, permissions: parsed.data.permissions }, cards: [preview.card] }
    } catch (error) {
      return toolError("高级分析被拒绝", error instanceof Error ? error.message : String(error))
    }
  }
  if (name === "run_kdb_scan") {
    const parsed = scanRequestSchema.safeParse(rawArgs)
    if (!parsed.success) return toolError("全库扫描请求无效", parsed.error.issues.map((item) => item.message).join("；"))
    try {
      const preview = createScanPreview(parsed.data)
      return { model: { phase: "preview", actionId: preview.actionId, task: parsed.data }, cards: [preview.card] }
    } catch (error) {
      return toolError("全库扫描被拒绝", error instanceof Error ? error.message : String(error))
    }
  }
  if (name === "run_kdb_sql") {
    const parsed = sqlRequestSchema.safeParse(rawArgs)
    if (!parsed.success) return toolError("专家 SQL 请求无效", parsed.error.issues.map((item) => item.message).join("；"))
    try {
      const preview = await createSqlPreview(parsed.data, settings)
      return { model: { phase: "preview", actionId: preview.actionId, purpose: parsed.data.purpose }, cards: [preview.card] }
    } catch (error) {
      return toolError("专家 SQL 被拒绝", error instanceof Error ? error.message : String(error))
    }
  }
  if (name !== "run_kdb_cli_plan") return toolError("未知工具", `不允许的工具: ${name}`)
  const parsed = cliPlanSchema.safeParse(rawArgs)
  if (!parsed.success) return toolError("命令计划无效", parsed.error.issues.map((item) => item.message).join("；"))

  const duplicateIds = new Set<string>()
  for (const step of parsed.data.steps) {
    if (duplicateIds.has(step.id)) return toolError("命令计划无效", `步骤 ID 重复: ${step.id}`)
    duplicateIds.add(step.id)
  }

  const results: CliStepResult[] = []
  const cards: ResultCard[] = []
  for (const step of parsed.data.steps) {
    const checked = normalizeAndValidate(step, parsed.data.steps.length, settings.exportMaxRows)
    if (!checked.ok) {
      const result: CliStepResult = { id: step.id, purpose: step.purpose, argv: step.argv, ok: false, exitCode: -1, attempts: 0, error: checked.error }
      results.push(result)
      cards.push(errorCard("KDB 命令计划被拒绝", `${step.id}：${checked.error}`))
      continue
    }
    const result = await runCliStep({ ...step, argv: checked.argv }, settings)
    results.push(result)
    cards.push(cardForStep(result, settings))
  }

  const succeeded = results.filter((result) => result.ok).length
  cards.unshift({ id: randomUUID(), kind: succeeded === results.length ? "success" : "data", title: "KDB CLI 计划完成", summary: `${succeeded}/${results.length} 个步骤成功；每一步均由内置 CLI 执行。`, data: { results: results.map(redactConfirmationToken) } })
  return { model: { results: results.map(redactConfirmationToken) }, cards }
}

export async function confirmAction(actionId: string, settings: AppSettings): Promise<ResultCard> {
  const action = pendingActions.get(actionId)
  if (!action) return errorCard("操作已失效", "未找到该预览操作；请重新发起请求。")
  const result = await runCliStep({ id: actionId, purpose: "用户确认执行", argv: [...action.argv, "--confirm", action.confirmationToken] }, settings, true)
  if (!result.ok) return errorCard("确认操作失败", result.error ?? "CLI 未返回成功结果")
  pendingActions.delete(actionId)
  return { id: randomUUID(), kind: "success", title: "操作已提交", summary: "内置 CLI 已执行确认操作；请继续查询状态或回执验证设备效果。", data: result.data as Record<string, unknown> }
}

export async function runAnalysis(actionId: string, settings: AppSettings): Promise<ResultCard> {
  return runAnalysisAction(actionId, settings)
}

export async function runScan(actionId: string, settings: AppSettings): Promise<ResultCard> { return runScanAction(actionId, settings) }
export async function runSql(actionId: string, settings: AppSettings): Promise<ResultCard> { return runSqlAction(actionId, settings) }
export async function resumeScan(taskId: string, settings: AppSettings): Promise<ResultCard> { return resumeScanTask(taskId, settings) }
export function pauseScan(taskId: string): void { pauseScanTask(taskId) }
export function stopScan(taskId: string): void { stopScanTask(taskId) }

export function cancelAction(actionId: string): void {
  pendingActions.delete(actionId)
  cancelAnalysisAction(actionId)
}

function normalizeAndValidate(step: PlannedStep, totalSteps: number, exportMaxRows: number): { ok: true; argv: string[] } | { ok: false; error: string } {
  const argv = stripModelOutputOptions(step.argv)
  if (!TOP_LEVEL.has(argv[0]!)) return { ok: false, error: `不允许的顶级 CLI 命令: ${argv[0]}` }
  if (argv.some((token) => token.includes("\0") || /[\r\n]/.test(token))) return { ok: false, error: "参数不能包含换行或 NUL 字符" }
  if (argv.some((token) => isBlockedOption(token))) return { ok: false, error: "模型不能指定配置根目录、外部清单、历史文件或确认令牌" }
  if (argv.some((token) => token === "--help" || token === "-h" || token === "--version")) return { ok: false, error: "帮助与版本查询不属于业务执行计划" }
  if (argv.includes("--json")) return { ok: false, error: "--json 由桌面执行器统一附加" }

  const isBatchExport = argv[0] === "batch" && argv[1] === "export" && argv[2] === "realtime"
  const isExport = argv[0] === "export" || (argv[0] === "battery" && argv[1] === "export")
  if (isBatchExport) {
    argv.push("--output-dir", path.join(desktopExportDirectory(), planFolderName(totalSteps)))
  } else if (isExport) {
    argv.push("--output", path.join(desktopExportDirectory(), `${step.id}-${Date.now()}.xlsx`))
  }
  if ((isExport || isBatchExport) && !hasOption(argv, "--source")) argv.push("--source", "auto")
  if (isExport || isBatchExport) argv.push("--max-rows", String(exportMaxRows))
  argv.push("--json")
  return { ok: true, argv }
}

function stripModelOutputOptions(argv: string[]): string[] {
  const cleaned: string[] = []
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!
    if (MODEL_OUTPUT_OPTIONS.has(token)) {
      index++
      continue
    }
    if (["--output=", "--output-dir=", "-o=", "--max-rows="].some((prefix) => token.startsWith(prefix))) continue
    cleaned.push(token)
  }
  return cleaned
}

function isBlockedOption(token: string): boolean {
  return BLOCKED_OPTIONS.has(token) || [...BLOCKED_OPTIONS].some((option) => token.startsWith(`${option}=`))
}

function hasOption(argv: string[], name: string): boolean {
  return argv.some((token) => token === name || token.startsWith(`${name}=`))
}

function planFolderName(totalSteps: number): string {
  return `batch-${new Date().toISOString().replace(/[:.]/g, "-")}-${totalSteps}`
}

function desktopExportDirectory(): string {
  return path.join(app.getPath("documents"), "KDB Copilot Exports")
}

function cliEntry(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "kdb-core", "interfaces", "cli", "cli.js")
  return path.resolve(app.getAppPath(), "..", "dist", "interfaces", "cli", "cli.js")
}

async function runCliStep(step: PlannedStep, settings: AppSettings, confirmed = false): Promise<CliStepResult> {
  const argv = [...step.argv, "--root-dir", settings.kdbConfigRoot]
  let attempts = 0
  let execution: { exitCode: number; stdout: string; stderr: string }
  do {
    attempts++
    execution = await spawnCli(argv)
    if (!shouldRetryLocalRoute(argv, execution) || attempts === 3) break
    await wait(attempts * 750)
  } while (true)
  const data = parseJson(execution.stdout)
  if (execution.exitCode !== 0) {
    const baseError = execution.stderr.trim() || execution.stdout.trim() || "CLI 执行失败"
    const error = attempts > 1 && /EHOSTUNREACH/.test(baseError) ? `${baseError}（已重试 ${attempts} 次）` : baseError
    return { id: step.id, purpose: step.purpose, argv: step.argv, ok: false, exitCode: execution.exitCode, attempts, error, ...(data !== undefined ? { data } : {}) }
  }
  return { id: step.id, purpose: step.purpose, argv: step.argv, ok: true, exitCode: 0, attempts, ...(data !== undefined ? { data } : {}), ...(confirmed ? { confirmed: true } : {}) } as CliStepResult
}

function shouldRetryLocalRoute(argv: string[], execution: { exitCode: number; stdout: string; stderr: string }): boolean {
  return execution.exitCode !== 0 && hasOption(argv, "--source") && /EHOSTUNREACH/.test(`${execution.stdout}\n${execution.stderr}`)
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function spawnCli(argv: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry(), ...argv], {
      cwd: app.getPath("userData"),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      shell: false,
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    const timeout = setTimeout(() => child.kill(), 120_000)
    child.stdout.on("data", (chunk) => { stdout += String(chunk) })
    child.stderr.on("data", (chunk) => { stderr += String(chunk) })
    child.once("error", (error) => { clearTimeout(timeout); reject(error) })
    child.once("close", (code) => { clearTimeout(timeout); resolve({ exitCode: code ?? 1, stdout, stderr }) })
  })
}

function parseJson(text: string): unknown | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  try { return JSON.parse(trimmed) } catch { return { rawOutput: trimmed } }
}

function cardForStep(result: CliStepResult, settings: AppSettings): ResultCard {
  if (!result.ok) return errorCard("KDB CLI 操作失败", `${result.id}：${result.error}`)
  const data = (result.data && typeof result.data === "object" ? result.data : {}) as Record<string, unknown>
  const token = typeof data.confirmationToken === "string" ? data.confirmationToken : undefined
  if (token) {
    const actionId = randomUUID()
    const argv = result.argv.filter((token) => token !== "--json")
    pendingActions.set(actionId, { argv, confirmationToken: token })
    return { id: randomUUID(), kind: "preview", title: "CLI 操作预览", summary: `${result.purpose}。确认后才会执行写操作。`, data: { ...data, confirmationToken: "[已由桌面端保管]" }, actionId, actionLabel: "确认执行" }
  }
  const outputPath = typeof data.outputPath === "string" ? data.outputPath : undefined
  const source = typeof data.source === "string" ? ` · ${data.source}` : ""
  const rowCount = data.rowCount === undefined ? "" : ` · ${data.rowCount} 条`
  return { id: randomUUID(), kind: outputPath ? "export" : "data", title: "KDB CLI 操作完成", summary: `${result.purpose}${source}${rowCount}`, data }
}

function toolError(title: string, summary: string): { model: unknown; cards: ResultCard[] } {
  return { model: { ok: false, error: summary }, cards: [errorCard(title, summary)] }
}

function redactConfirmationToken(result: CliStepResult): CliStepResult {
  if (!result.data || typeof result.data !== "object" || !("confirmationToken" in result.data)) return result
  return { ...result, data: { ...(result.data as Record<string, unknown>), confirmationToken: "[已由桌面端保管]" } }
}

function errorCard(title: string, summary: string): ResultCard {
  return { id: randomUUID(), kind: "error", title, summary }
}

function definition(name: string, description: string, schema: z.ZodType): Record<string, unknown> {
  return { type: "function", function: { name, description, parameters: z.toJSONSchema(schema), strict: false } }
}
