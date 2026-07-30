import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { app } from "electron"
import type { AppSettings, ResultCard, ScanProgress } from "../shared.js"
import { getCore, getKdbClients } from "./kdb-core.js"
import { scanRequestSchema, type ScanRequest } from "./scan-contract.js"
import { ScanTaskStore, type ScanTask } from "./scan-task-store.js"

const BATCH_SIZE = 100
const CONCURRENCY = 4
const BATCH_ROW_LIMIT = 20_000
type ScanItem = { source: "api" | "local"; generation: "gen2" | "gen3"; batteryId: string }
type RunningScan = { pauseRequested: boolean; stopRequested: boolean; deleteAfterStop: boolean }

let taskStore: ScanTaskStore | undefined
const pendingScans = new Map<string, ScanRequest>()
const runningScans = new Map<string, RunningScan>()
const progressListeners = new Set<(progress: ScanProgress) => void>()

export function configureScanStore(userDataPath: string): void { taskStore ??= new ScanTaskStore(userDataPath) }
export function closeScanStore(): void { taskStore?.close(); taskStore = undefined }
export function onScanProgress(listener: (progress: ScanProgress) => void): () => void { progressListeners.add(listener); return () => progressListeners.delete(listener) }
function emit(progress: ScanProgress): void { for (const listener of progressListeners) listener(progress) }

export function createScanPreview(request: unknown): { card: ResultCard; actionId: string } {
  const parsed = scanRequestSchema.safeParse(request)
  if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.message).join("；"))
  const actionId = randomUUID()
  pendingScans.set(actionId, parsed.data)
  return {
    actionId,
    card: {
      id: randomUUID(), kind: "scan-preview", title: "全库扫描预览",
      summary: `${parsed.data.purpose}。任务会分批执行，可暂停、继续或停止。`,
      data: { ...parsed.data, batchSize: BATCH_SIZE, concurrency: CONCURRENCY, totalRowsUnlimited: true },
      actionId, actionLabel: "开始扫描",
    },
  }
}

export async function runScanAction(actionId: string, settings: AppSettings): Promise<ResultCard> {
  const request = pendingScans.get(actionId)
  if (!request) return errorCard("扫描预览已失效", "请重新发起扫描请求。")
  pendingScans.delete(actionId)
  const store = requireStore()
  const task = store.create(randomUUID(), request)
  task.files.push(taskOutputDir(task.taskId))
  store.update(task)
  void startTask(task, settings)
  return scanCard(task)
}

export async function resumeScanTask(taskId: string, settings: AppSettings): Promise<ResultCard> {
  const task = requireStore().get(taskId)
  if (!task) return errorCard("扫描任务不存在", "未找到可恢复的扫描任务。")
  if (task.status === "completed") return scanCard(task)
  task.status = "queued"
  if (!task.files.includes(taskOutputDir(task.taskId))) task.files.unshift(taskOutputDir(task.taskId))
  requireStore().update(task)
  void startTask(task, settings)
  return scanCard(task)
}

export function pauseScanTask(taskId: string): void { const running = runningScans.get(taskId); if (running) running.pauseRequested = true }
export function stopScanTask(taskId: string): void { const running = runningScans.get(taskId); if (running) running.stopRequested = true }
export function deleteScanTask(taskId: string): void {
  const running = runningScans.get(taskId)
  if (running) {
    running.stopRequested = true
    running.deleteAfterStop = true
    emit({ taskId, phase: "stopped", message: "正在停止并删除扫描任务…" })
    return
  }
  requireStore().delete(taskId)
}
export function listActiveScanTasks(): ScanTask[] { return requireStore().listActive() }

async function startTask(task: ScanTask, settings: AppSettings): Promise<ResultCard> {
  if (runningScans.has(task.taskId)) return errorCard("扫描正在运行", "该任务已经在执行。")
  const running: RunningScan = { pauseRequested: false, stopRequested: false, deleteAfterStop: false }
  runningScans.set(task.taskId, running)
  task.status = "running"
  requireStore().update(task)
  emit({ taskId: task.taskId, phase: "running", message: "扫描任务已启动。", batch: task.cursor.batch })
  try {
    const result = await executeTask(task, settings, running)
    return scanCard(result)
  } catch (error) {
    task.status = "failed"
    task.errors.push(error instanceof Error ? error.message : String(error))
    requireStore().update(task)
    emit({ taskId: task.taskId, phase: "failed", message: task.errors.at(-1)! })
    return errorCard("全库扫描失败", task.errors.at(-1)!)
  } finally {
    runningScans.delete(task.taskId)
    if (running.deleteAfterStop) requireStore().delete(task.taskId)
  }
}

async function executeTask(task: ScanTask, settings: AppSettings, running: RunningScan): Promise<ScanTask> {
  const core = await getCore()
  const clients = await getKdbClients(settings)
  const items = await collectItems(core, clients, task.request, task)
  const outputDir = taskOutputDir(task.taskId)
  await mkdir(outputDir, { recursive: true })
  if (!task.files.includes(outputDir)) task.files.push(outputDir)
  for (let index = task.cursor.itemIndex; index < items.length; index += BATCH_SIZE) {
    if (running.stopRequested) { task.status = "stopped"; requireStore().update(task); emit({ taskId: task.taskId, phase: "stopped", message: "扫描已停止。", scanned: task.stats.scanned, matched: task.stats.matched, rows: task.stats.rows }); return task }
    if (running.pauseRequested) { task.status = "paused"; task.cursor.itemIndex = index; requireStore().update(task); emit({ taskId: task.taskId, phase: "paused", message: "扫描已暂停，可稍后继续。", cursor: String(index), scanned: task.stats.scanned, matched: task.stats.matched, rows: task.stats.rows }); return task }
    const batch = items.slice(index, index + BATCH_SIZE)
    let batchRows = 0
    task.cursor.itemIndex = index
    task.cursor.batch++
    emit({ taskId: task.taskId, phase: "running", message: `正在扫描第 ${task.cursor.batch} 批（${batch.length} 个目标）。`, batch: task.cursor.batch, scanned: task.stats.scanned, matched: task.stats.matched, rows: task.stats.rows, total: items.length })
    for (let offset = 0; offset < batch.length; offset += CONCURRENCY) {
      const group = batch.slice(offset, offset + CONCURRENCY)
      await Promise.all(group.map(async (item) => {
        if (running.stopRequested || running.pauseRequested) return
        try {
          const result = await retryScan<any>(() => core.listAnalysisHistory({ clients, batteryId: item.batteryId, generation: item.generation, source: item.source, start: task.request.start, end: task.request.end, filters: task.request.filters.filter((filter: any) => !["batteryId", "generation"].includes(filter.field)), limit: BATCH_ROW_LIMIT }))
          task.stats.scanned++
          const matchingRows = result.rows.filter((row: Record<string, unknown>) => matchesFilters(row, task.request.filters, item))
          const acceptedRows = Math.min(matchingRows.length, Math.max(0, BATCH_ROW_LIMIT - batchRows))
          batchRows += acceptedRows
          task.stats.rows += acceptedRows
          if (acceptedRows > 0) {
            task.stats.matched++
            const detailPath = path.join(outputDir, `${item.source}-${item.generation}-${item.batteryId}.xlsx`)
            if (task.request.exportDetails) {
              await core.writeAnalysisWorkbook({ outputPath: detailPath, rows: matchingRows.slice(0, acceptedRows), title: `${item.source}-${item.batteryId}` })
              task.files.push(detailPath)
            }
          }
        } catch (error) {
          task.stats.scanned++
          task.stats.failed++
          task.errors.push(`[${item.source}/${item.generation}/${item.batteryId}] ${error instanceof Error ? error.message : String(error)}`)
        }
      }))
      requireStore().update(task)
      emit({ taskId: task.taskId, phase: "running", message: `已完成第 ${task.cursor.batch} 批。`, batch: task.cursor.batch, scanned: task.stats.scanned, matched: task.stats.matched, rows: task.stats.rows, failed: task.stats.failed, total: items.length })
      if (running.stopRequested || running.pauseRequested) {
        task.cursor.itemIndex = index + offset + group.length
        task.status = running.stopRequested ? "stopped" : "paused"
        requireStore().update(task)
        emit({ taskId: task.taskId, phase: task.status, message: running.stopRequested ? "扫描已停止。" : "扫描已暂停，可稍后继续。", cursor: String(task.cursor.itemIndex), scanned: task.stats.scanned, matched: task.stats.matched, rows: task.stats.rows, failed: task.stats.failed, total: items.length })
        return task
      }
    }
    task.cursor.itemIndex = index + batch.length
    requireStore().update(task)
  }
  const summaryPath = path.join(outputDir, "summary.xlsx")
  await core.writeAnalysisWorkbook({ outputPath: summaryPath, rows: [{ taskId: task.taskId, purpose: task.request.purpose, source: task.request.source, generations: task.request.generations.join(","), scanned: task.stats.scanned, matched: task.stats.matched, rows: task.stats.rows, failed: task.stats.failed, completedAt: new Date().toISOString() }], title: "summary" })
  task.files.push(summaryPath)
  task.status = "completed"
  task.cursor.itemIndex = items.length
  requireStore().update(task)
  emit({ taskId: task.taskId, phase: "completed", message: `扫描完成：匹配 ${task.stats.matched} 个目标，共 ${task.stats.rows} 条记录。`, scanned: task.stats.scanned, matched: task.stats.matched, rows: task.stats.rows, failed: task.stats.failed, total: items.length })
  return task
}

async function collectItems(core: Record<string, any>, clients: any, request: ScanRequest, task: ScanTask): Promise<ScanItem[]> {
  const items: ScanItem[] = []
  if (request.source === "local" || request.source === "both") {
    try {
      const repository = core.createLocalHistoryRepository(clients.config)
      const tables = await repository.listHistoryTables(request.generations)
      items.push(...tables.map((table: any) => ({ source: "local" as const, generation: table.generation, batteryId: table.batteryId })))
    } catch (error) {
      task.errors.push(`[local] ${error instanceof Error ? error.message : String(error)}`)
      if (request.source === "local") throw error
    }
  }
  if (request.source === "api" || request.source === "both") {
    for (const generation of request.generations) {
      try {
        const result = await retryScan<any>(() => core.listAnalysisBatteries({ clients, generation, source: "api", filters: [], limit: 100_000 }))
        for (const row of result.rows) {
          const batteryId = String(row.batteryId ?? "").toUpperCase()
          if (/^[0-9A-F]{8}$/.test(batteryId)) items.push({ source: "api", generation, batteryId })
        }
      } catch (error) {
        task.errors.push(`[api/${generation}] ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  return items.sort((a, b) => `${a.source}/${a.generation}/${a.batteryId}`.localeCompare(`${b.source}/${b.generation}/${b.batteryId}`))
}

function requireStore(): ScanTaskStore { if (!taskStore) throw new Error("扫描任务存储尚未初始化"); return taskStore }
function taskOutputDir(taskId: string): string { return path.join(app.getPath("documents"), "KDB Copilot Exports", `scan-${taskId}`) }
async function retryScan<T>(operation: () => Promise<T>): Promise<T> {
  let last: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await operation() } catch (error) {
      last = error
      const message = error instanceof Error ? error.message : String(error)
      if (!/(EHOSTUNREACH|ETIMEDOUT|ECONNRESET|ECONNREFUSED|连接失败)/i.test(message) || attempt === 3) throw error
      await new Promise((resolve) => setTimeout(resolve, attempt * 750))
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}
function matchesFilters(row: Record<string, unknown>, filters: ScanRequest["filters"], item: ScanItem): boolean {
  return filters.every((filter) => {
    const actual = filter.field === "batteryId" ? item.batteryId : filter.field === "generation" ? item.generation : row[filter.field]
    if (filter.operator === "in") return Array.isArray(filter.value) && filter.value.some((value) => String(actual) === String(value))
    if (filter.operator === "contains") return typeof actual === "string" && typeof filter.value === "string" && actual.includes(filter.value)
    if (filter.operator === "eq") return String(actual) === String(filter.value)
    if (filter.operator === "neq") return String(actual) !== String(filter.value)
    const left = Number(actual); const right = Number(filter.value)
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false
    if (filter.operator === "gt") return left > right
    if (filter.operator === "gte") return left >= right
    if (filter.operator === "lt") return left < right
    return left <= right
  })
}
function scanCard(task: ScanTask): ResultCard {
  const title = task.status === "completed" ? "全库扫描完成" : task.status === "paused" ? "全库扫描已暂停" : task.status === "stopped" ? "全库扫描已停止" : "全库扫描任务"
  const outputDir = task.files.find((file) => file.includes(`/scan-${task.taskId}`) || file.includes(`\\scan-${task.taskId}`))
  return { id: randomUUID(), kind: "scan", title, summary: `${task.request.purpose}。已扫描 ${task.stats.scanned} 个目标，匹配 ${task.stats.matched} 个，共 ${task.stats.rows} 条记录。`, data: { taskId: task.taskId, status: task.status, ...task.stats, ...(outputDir ? { outputDir } : {}), files: task.files, errors: task.errors.slice(-100), cursor: task.cursor } }
}
function errorCard(title: string, summary: string): ResultCard { return { id: randomUUID(), kind: "error", title, summary } }
