export function validateAnalysisScript(script: string): void {
  if (script.length < 1 || script.length > 32_768) throw new Error("分析脚本长度必须在 1~32768 字符之间")
  if (!/async\s+function\s+main\s*\(/.test(script) && !/function\s+main\s*\(/.test(script)) throw new Error("分析脚本必须定义 function main(kdb)")
  const forbidden = /(?:\brequire\s*\(|\bimport\s|\bprocess\b|\bglobalThis\b|\b(?:fs|net|http|https|fetch|XMLHttpRequest|WebSocket|child_process|worker_threads)\b|\beval\s*\(|\bFunction\s*\(|__dirname|__filename|\.\.\/|\.\.\\)/i
  if (forbidden.test(script)) throw new Error("分析脚本包含不允许的模块、进程、文件或动态代码访问")
}

export function validateAnalysisIntent(purpose: string, script: string): void {
  const historicalFaultRequest = /最近|历史|出现过|曾经|过去|historical|last\s+\w+/i.test(purpose)
    && /故障|高温|过温|fault|108/i.test(purpose)
  if (!historicalFaultRequest) return

  const readsHistory = /kdb\.read\.history\s*\(/.test(script)
  if (!readsHistory) {
    throw new Error("当前基础表只表示最新快照，不能回答历史故障；请提供电池 ID/txt/csv 清单后逐个读取历史数据")
  }

  if (/kdb\.read\.batteries[\s\S]{0,800}faultStatus/i.test(script)) {
    throw new Error("历史故障分析不能用基础表当前 faultStatus 作为候选条件；请读取候选电池后逐个调用 read.history")
  }

  // A scan may start from the current battery base as an explicit candidate
  // inventory, then call read.history one battery at a time. The result must
  // still disclose that the inventory is a snapshot rather than an implicit
  // full scan of every archived table.
}
