import process from "process"
import { createKdbClients } from "../index.js"

type Generation = "gen2" | "gen3"

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

type ApiResponse = {
  code?: number | string
  msg?: string
  [key: string]: unknown
}

function asCodeNumber(code: ApiResponse["code"]): number | undefined {
  if (typeof code === "number") return code
  if (typeof code === "string" && code.trim()) {
    const n = Number(code)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

function pickGenerations(): Generation[] {
  const v = (process.env.KDB_GENERATION ?? "").trim().toLowerCase()
  if (v === "gen2") return ["gen2"]
  if (v === "gen3") return ["gen3"]
  return ["gen2", "gen3"]
}

async function assertOk(generation: Generation, action: string, data: ApiResponse): Promise<void> {
  const code = asCodeNumber(data.code)
  if (code !== 200) {
    const msg = typeof data.msg === "string" ? data.msg : JSON.stringify(data)
    throw new Error(`[${generation}] ${action} 失败: code=${String(data.code)} msg=${msg}`)
  }
}

function printApiResult(generation: Generation, action: string, payload: unknown): void {
  process.stdout.write(`[${generation}] ${action} response:\n${safeStringify(payload)}\n`)
}

async function main(): Promise<void> {
  const clients = await createKdbClients()
  const gens = pickGenerations()

  let failed = false
  for (const generation of gens) {
    try {
      const client = clients.getClient(generation)

      const info = await client.getInfo()
      printApiResult(generation, "getInfo", info.data)
      await assertOk(generation, "getInfo", info.data as ApiResponse)

      const routers = await client.request<ApiResponse>({ path: "/getRouters", method: "GET" })
      printApiResult(generation, "getRouters", routers.data)
      await assertOk(generation, "getRouters", routers.data)

      process.stdout.write(`[${generation}] OK(token)\n`)
    } catch (err) {
      failed = true
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`${msg}\n`)
    }
  }

  if (failed) {
    process.exitCode = 1
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err)
  process.stderr.write(`${msg}\n`)
  process.exitCode = 1
})
