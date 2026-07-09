export type AjaxResult<T = unknown> = {
  code?: number | string
  msg?: string
  data?: T
  [key: string]: unknown
}

function asCodeNumber(code: AjaxResult["code"]): number | undefined {
  if (typeof code === "number") return code
  if (typeof code === "string" && code.trim()) {
    const n = Number(code)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

export function assertAjaxOk(args: { generation: string; action: string; result: AjaxResult }): void {
  const code = asCodeNumber(args.result.code)
  if (code !== 200) {
    const msg =
      typeof args.result.msg === "string" ? args.result.msg : JSON.stringify(args.result)
    throw new Error(`[${args.generation}] ${args.action} 失败: code=${String(args.result.code)} msg=${msg}`)
  }
}

