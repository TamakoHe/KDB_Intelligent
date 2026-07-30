import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ScanTaskStore } from "../desktop/src/main/scan-task-store.js"

test("扫描任务保存游标、状态和错误后可重新加载", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kdb-scan-"))
  try {
    const request = { id: "scan", purpose: "测试扫描", source: "local", generations: ["gen3"], start: "2026-07-01", end: "2026-07-02", filters: [], exportDetails: true } as any
    const first = new ScanTaskStore(dir)
    const task = first.create("task-1", request)
    task.status = "paused"
    task.cursor.itemIndex = 100
    task.stats.scanned = 100
    task.errors.push("分表不存在")
    first.update(task)
    first.close()
    const second = new ScanTaskStore(dir)
    const restored = second.get("task-1")!
    assert.equal(restored.status, "paused")
    assert.equal(restored.cursor.itemIndex, 100)
    assert.equal(restored.stats.scanned, 100)
    assert.deepEqual(restored.errors, ["分表不存在"])
    second.delete("task-1")
    assert.equal(second.get("task-1"), undefined)
    second.close()
  } finally { await rm(dir, { recursive: true, force: true }) }
})
