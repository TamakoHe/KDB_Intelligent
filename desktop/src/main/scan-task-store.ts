import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import type { ScanRequest } from "./scan-contract.js"

export type ScanTaskStatus = "queued" | "running" | "paused" | "completed" | "stopped" | "failed"
export type ScanTask = {
  taskId: string
  status: ScanTaskStatus
  request: ScanRequest
  cursor: { sourceIndex: number; generationIndex: number; itemIndex: number; batch: number }
  stats: { scanned: number; matched: number; rows: number; failed: number }
  files: string[]
  errors: string[]
  createdAt: string
  updatedAt: string
}

export class ScanTaskStore {
  private readonly db: DatabaseSync

  constructor(userDataPath: string) {
    this.db = new DatabaseSync(path.join(userDataPath, "scan-tasks.sqlite"))
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scan_tasks (
        task_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        request_json TEXT NOT NULL,
        cursor_json TEXT NOT NULL,
        stats_json TEXT NOT NULL,
        files_json TEXT NOT NULL,
        errors_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
  }

  create(taskId: string, request: ScanRequest): ScanTask {
    const now = new Date().toISOString()
    const task: ScanTask = {
      taskId,
      status: "queued",
      request,
      cursor: { sourceIndex: 0, generationIndex: 0, itemIndex: 0, batch: 0 },
      stats: { scanned: 0, matched: 0, rows: 0, failed: 0 },
      files: [],
      errors: [],
      createdAt: now,
      updatedAt: now,
    }
    this.write(task)
    return task
  }

  get(taskId: string): ScanTask | undefined {
    const row = this.db.prepare("SELECT * FROM scan_tasks WHERE task_id = ?").get(taskId) as Record<string, string> | undefined
    return row ? decode(row) : undefined
  }

  listActive(): ScanTask[] {
    const rows = this.db.prepare("SELECT * FROM scan_tasks WHERE status IN ('queued','running','paused') ORDER BY updated_at DESC").all() as Array<Record<string, string>>
    return rows.map(decode)
  }

  update(task: ScanTask): void {
    task.updatedAt = new Date().toISOString()
    this.write(task)
  }

  delete(taskId: string): void {
    this.db.prepare("DELETE FROM scan_tasks WHERE task_id = ?").run(taskId)
  }

  close(): void { this.db.close() }

  private write(task: ScanTask): void {
    this.db.prepare(`
      INSERT INTO scan_tasks (task_id, status, request_json, cursor_json, stats_json, files_json, errors_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET status=excluded.status, request_json=excluded.request_json, cursor_json=excluded.cursor_json, stats_json=excluded.stats_json, files_json=excluded.files_json, errors_json=excluded.errors_json, updated_at=excluded.updated_at
    `).run(task.taskId, task.status, JSON.stringify(task.request), JSON.stringify(task.cursor), JSON.stringify(task.stats), JSON.stringify(task.files), JSON.stringify(task.errors), task.createdAt, task.updatedAt)
  }
}

function decode(row: Record<string, string>): ScanTask {
  return {
    taskId: row.task_id!,
    status: row.status as ScanTaskStatus,
    request: JSON.parse(row.request_json!) as ScanRequest,
    cursor: JSON.parse(row.cursor_json!),
    stats: JSON.parse(row.stats_json!),
    files: JSON.parse(row.files_json!),
    errors: JSON.parse(row.errors_json!),
    createdAt: row.created_at!,
    updatedAt: row.updated_at!,
  }
}
