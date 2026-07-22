import assert from "node:assert/strict"
import test from "node:test"
import { validateAnalysisScript } from "../desktop/src/main/analysis-security.js"

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
