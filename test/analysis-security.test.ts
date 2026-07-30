import assert from "node:assert/strict"
import test from "node:test"
import { validateAnalysisIntent, validateAnalysisScript } from "../desktop/src/main/analysis-security.js"

test("高级分析脚本必须定义 main 且拒绝 Node/动态代码能力", () => {
  validateAnalysisScript("async function main(kdb){ return {ok: true}; }")
  for (const script of [
    "async function main(kdb){ return require('fs').readFileSync('x'); }",
    "async function main(kdb){ return fetch('https://example.com'); }",
    "async function main(kdb){ return eval('1+1'); }",
    "async function main(kdb){ return process.env; }",
    "const x = 1;",
  ]) assert.throws(() => validateAnalysisScript(script))
})

test("高级分析脚本长度上限为 32 KB", () => {
  assert.throws(() => validateAnalysisScript(`async function main(kdb){ return '${"x".repeat(32_769)}'; }`), /长度/)
})

test("历史故障分析不能把基础表当前状态冒充历史事件", () => {
  assert.throws(
    () => validateAnalysisIntent(
      "筛选最近两周出现过充电高温的电池",
      "async function main(kdb){ return await kdb.read.batteries({ filters: [{ field: 'faultStatus', operator: 'eq', value: 108 }] }); }",
    ),
    /当前基础表只表示最新快照/,
  )
  assert.throws(
    () => validateAnalysisIntent(
      "筛选最近两周出现过充电高温的电池",
      "async function main(kdb){ const rows = await kdb.read.batteries({ filters: [{ field: 'faultStatus', operator: 'eq', value: 108 }] }); return kdb.read.history({ batteryId: '623B1C10', generation: 'gen3', start: '2026-07-01', end: '2026-07-22' }); }",
    ),
    /不能用基础表当前 faultStatus/,
  )
  validateAnalysisIntent(
    "导出电池 623B1C10 最近两周出现过的故障数据",
    "async function main(kdb){ return await kdb.read.history({ batteryId: '623B1C10', generation: 'gen3', start: '2026-07-01', end: '2026-07-22' }); }",
  )
})
