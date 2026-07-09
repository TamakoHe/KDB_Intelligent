import process from "process"
import { createKdbClients } from "../index.js"

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

async function main(): Promise<void> {
  const clients = await createKdbClients()
  const client = clients.getClient("gen2")

  const end = new Date(process.env.KDB_END_TIME?.trim() || Date.now())
  const start = new Date(process.env.KDB_START_TIME?.trim() || end.getTime() - 24 * 60 * 60 * 1000)

  const batteryId = (process.env.KDB_BATTERY_ID ?? "").trim()

  const res = await client.request<any>({
    path: "/hckd/hckdNettyLog/list",
    method: "GET",
    query: {
      pageNum: 1,
      pageSize: 20,
      ...(batteryId ? { batteryId } : {}),
      params: {
        beginCreateTime: fmt(start),
        endCreateTime: fmt(end),
      },
    },
    timeoutMs: 60000,
  })

  process.stdout.write(JSON.stringify(res.data, null, 2) + "\n")
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err)
  process.stderr.write(`${msg}\n`)
  process.exitCode = 1
})
