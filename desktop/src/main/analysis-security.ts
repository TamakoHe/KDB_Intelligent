export function validateAnalysisScript(script: string): void {
  if (script.length < 1 || script.length > 32_768) throw new Error("分析脚本长度必须在 1~32768 字符之间")
  if (!/async\s+function\s+main\s*\(/.test(script) && !/function\s+main\s*\(/.test(script)) throw new Error("分析脚本必须定义 function main(kdb)")
  const forbidden = /(?:\brequire\s*\(|\bimport\s|\bprocess\b|\bglobalThis\b|\b(?:fs|net|http|https|fetch|XMLHttpRequest|WebSocket|child_process|worker_threads)\b|\beval\s*\(|\bFunction\s*\(|__dirname|__filename|\.\.\/|\.\.\\)/i
  if (forbidden.test(script)) throw new Error("分析脚本包含不允许的模块、进程、文件或动态代码访问")
}
