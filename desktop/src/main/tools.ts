import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import path from "node:path"
import { app } from "electron"
import { z } from "zod"
import type { AppSettings, ResultCard } from "../shared.js"

type PlannedStep = { id: string; purpose: string; argv: string[] }
type PendingAction = { argv: string[]; confirmationToken: string }
type CliStepResult = { id: string; purpose: string; argv: string[]; ok: boolean; exitCode: number; data?: unknown; error?: string }

const pendingActions = new Map<string, PendingAction>()
const safeStepId = z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/)
const cliPlanSchema = z.object({
  steps: z.array(z.object({ id: safeStepId, purpose: z.string().trim().min(1).max(160), argv: z.array(z.string().min(1).max(300)).min(1).max(40) })).min(1).max(20),
})

const BLOCKED_OPTIONS = new Set(["--root-dir", "--output", "-o", "--output-dir", "--battery-file", "--history-file", "--confirm"])
const TOP_LEVEL = new Set(["battery", "status", "ready", "command-ready", "command", "parameter", "mode", "batch", "export", "ota"])

export const modelTools = [definition("run_kdb_cli_plan", "按 KDB CLI 技能执行一个受控命令计划。只传 kdb 后的 argv 数组，不要传 npm/node/shell。复杂需求可在一个计划内给出多个步骤；写操作只会产生预览，绝不能加入 --confirm。", cliPlanSchema)]

export async function executeTool(name: string, rawArgs: unknown, settings: AppSettings): Promise<{ model: unknown; cards: ResultCard[] }> {
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
    const checked = normalizeAndValidate(step, parsed.data.steps.length)
    if (!checked.ok) {
      const result: CliStepResult = { id: step.id, purpose: step.purpose, argv: step.argv, ok: false, exitCode: -1, error: checked.error }
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

export function cancelAction(actionId: string): void {
  pendingActions.delete(actionId)
}

function normalizeAndValidate(step: PlannedStep, totalSteps: number): { ok: true; argv: string[] } | { ok: false; error: string } {
  const argv = [...step.argv]
  if (!TOP_LEVEL.has(argv[0]!)) return { ok: false, error: `不允许的顶级 CLI 命令: ${argv[0]}` }
  if (argv.some((token) => token.includes("\0") || /[\r\n]/.test(token))) return { ok: false, error: "参数不能包含换行或 NUL 字符" }
  if (argv.some((token) => BLOCKED_OPTIONS.has(token))) return { ok: false, error: "模型不能指定配置根目录、文件路径或确认令牌" }
  if (argv.some((token) => token === "--help" || token === "-h" || token === "--version")) return { ok: false, error: "帮助与版本查询不属于业务执行计划" }
  if (argv.includes("--json")) return { ok: false, error: "--json 由桌面执行器统一附加" }

  const isBatchExport = argv[0] === "batch" && argv[1] === "export" && argv[2] === "realtime"
  const isExport = argv[0] === "export" || (argv[0] === "battery" && argv[1] === "export")
  if (isBatchExport) {
    argv.push("--output-dir", path.join(desktopExportDirectory(), planFolderName(totalSteps)))
  } else if (isExport) {
    argv.push("--output", path.join(desktopExportDirectory(), `${step.id}-${Date.now()}.xlsx`))
  }
  argv.push("--json")
  return { ok: true, argv }
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
  const execution = await spawnCli(argv)
  const data = parseJson(execution.stdout)
  if (execution.exitCode !== 0) return { id: step.id, purpose: step.purpose, argv: step.argv, ok: false, exitCode: execution.exitCode, error: execution.stderr.trim() || execution.stdout.trim() || "CLI 执行失败", ...(data !== undefined ? { data } : {}) }
  return { id: step.id, purpose: step.purpose, argv: step.argv, ok: true, exitCode: 0, ...(data !== undefined ? { data } : {}), ...(confirmed ? { confirmed: true } : {}) } as CliStepResult
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
