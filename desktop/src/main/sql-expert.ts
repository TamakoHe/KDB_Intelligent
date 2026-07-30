import { randomUUID } from "node:crypto"
import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"
import type { AppSettings, ResultCard } from "../shared.js"
import { sqlRequestSchema, type SqlRequest } from "./scan-contract.js"

const pendingSql = new Map<string, SqlRequest>()
const ALLOWED_SCHEMAS = new Set(["newenergy", "newenergy-battery", "kadianbao", "kadianbao-battery04", "kadianbao-battery06"])
const BLOCKED = /\b(?:insert|update|delete|replace|drop|alter|create|truncate|grant|revoke|call|do|handler|load_file|outfile|dumpfile|sleep|benchmark|into)\b/i

export async function createSqlPreview(request: unknown, settings: AppSettings): Promise<{ card: ResultCard; actionId: string }> {
  const parsed = sqlRequestSchema.safeParse(request)
  if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.message).join("；"))
  validateReadOnlySql(parsed.data.sql)
  let evaluation: unknown[] = []
  try {
    const { getCore, getKdbClients } = await import("./kdb-core.js")
    const core = await getCore()
    const clients = await getKdbClients(settings)
    const repository = core.createLocalHistoryRepository(clients.config)
    evaluation = (await repository.executeReadOnly(`EXPLAIN ${parsed.data.sql.replace(/;\s*$/, "")}`)).slice(0, 50)
  } catch (error) {
    throw new Error(`无法完成 SQL 成本评估：${error instanceof Error ? error.message : String(error)}`)
  }
  const actionId = randomUUID()
  pendingSql.set(actionId, parsed.data)
  return {
    actionId,
    card: {
      id: randomUUID(), kind: "sql-preview", title: "专家只读 SQL 预览",
      summary: `${parsed.data.purpose}。执行前请检查 SQL、访问范围和成本评估。`,
      data: { purpose: parsed.data.purpose, sql: parsed.data.sql, source: "local", evaluation, warning: "当前使用配置中的数据库账号；请确认账号具备历史库只读权限。" },
      actionId, actionLabel: "执行专家查询",
    },
  }
}

export async function runSqlAction(actionId: string, settings: AppSettings): Promise<ResultCard> {
  const request = pendingSql.get(actionId)
  if (!request) return errorCard("SQL 预览已失效", "请重新发起专家查询。")
  pendingSql.delete(actionId)
  const startedAt = Date.now()
  try {
    const { getCore, getKdbClients } = await import("./kdb-core.js")
    const core = await getCore()
    const clients = await getKdbClients(settings)
    const repository = core.createLocalHistoryRepository(clients.config)
    const sql = request.sql.replace(/;\s*$/, "")
    const boundedSql = `SELECT * FROM (${sql}) AS kdb_expert_result LIMIT 100001`
    const explain = await repository.executeReadOnly(`EXPLAIN ${boundedSql}`)
    const rows = await repository.executeReadOnly(boundedSql)
    if (rows.length > 100_000) throw new Error("专家查询结果超过 100,000 行，请增加时间或条件筛选")
    const { app } = await import("electron")
    const outputPath = path.join(app.getPath("documents"), "KDB Copilot Exports", `expert-sql-${Date.now()}.xlsx`)
    const file = await core.writeAnalysisWorkbook({ outputPath, rows, title: "expert-sql" })
    await appendAudit(app.getPath("userData"), { purpose: request.purpose, sql, ok: true, rowCount: rows.length, elapsedMs: Date.now() - startedAt })
    return { id: randomUUID(), kind: "sql", title: "专家查询完成", summary: `本地只读 SQL 已执行，返回 ${rows.length} 条记录。`, data: { ...file, rowCount: rows.length, source: "local", explain: explain.slice(0, 50), sql } }
  } catch (error) {
    try {
      const { app } = await import("electron")
      await appendAudit(app.getPath("userData"), { purpose: request.purpose, sql: request.sql, ok: false, elapsedMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) })
    } catch { /* audit failure must not hide the query error */ }
    return errorCard("专家 SQL 执行失败", error instanceof Error ? error.message : String(error))
  }
}

async function appendAudit(userDataPath: string, entry: Record<string, unknown>): Promise<void> {
  const dir = path.join(userDataPath, "audit")
  await mkdir(dir, { recursive: true })
  await appendFile(path.join(dir, "expert-sql.jsonl"), `${JSON.stringify({ ...entry, createdAt: new Date().toISOString() })}\n`, "utf8")
}

export function validateReadOnlySql(sql: string): void {
  const normalized = sql.trim()
  if (!normalized) throw new Error("SQL 不能为空")
  if (normalized.includes("\0") || /(?:--|\/\*|\*\/|(^|\s)#)/.test(normalized)) throw new Error("专家 SQL 不允许注释、NUL 或多语句注入")
  const withoutFinalSemicolon = normalized.replace(/;\s*$/, "")
  if (withoutFinalSemicolon.includes(";")) throw new Error("专家 SQL 只允许单条语句")
  if (!/^(?:select\b|with\b)/i.test(withoutFinalSemicolon)) throw new Error("专家 SQL 只能以 SELECT 或 WITH 开头")
  if (/^with\b/i.test(withoutFinalSemicolon) && !/\bselect\b/i.test(withoutFinalSemicolon)) throw new Error("WITH 查询必须最终包含 SELECT")
  if (BLOCKED.test(withoutFinalSemicolon)) throw new Error("专家 SQL 包含被禁止的写入、文件、过程或高风险关键字")
  const references = [...withoutFinalSemicolon.matchAll(/(?:`([^`]+)`|\b([A-Za-z][A-Za-z0-9_-]*)\b)\s*\.\s*(?:`([^`]+)`|\b([A-Za-z][A-Za-z0-9_]*)\b)/g)]
  for (const reference of references) {
    const schema = reference[1] ?? reference[2]
    if (schema && !ALLOWED_SCHEMAS.has(schema)) throw new Error(`专家 SQL 不允许访问 schema: ${schema}`)
  }
  const cteNames = new Set([...withoutFinalSemicolon.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\s+AS\s*\(/gi)].map((match) => match[1]!.toLowerCase()))
  for (const match of withoutFinalSemicolon.matchAll(/\b(?:from|join)\s+(`[^`]+`|[A-Za-z][A-Za-z0-9_-]*)(?:\s+|$|,)/gi)) {
    const token = match[1]!.replaceAll("`", "")
    if (token.includes(".")) continue
    if (!cteNames.has(token.toLowerCase()) && token.toLowerCase() !== "(") throw new Error(`专家 SQL 的表 ${token} 必须显式限定为允许的 schema.table`)
  }
}

function errorCard(title: string, summary: string): ResultCard { return { id: randomUUID(), kind: "error", title, summary } }
