import process from "process"
import { createKdbClients, queryBatteryBaseStatus } from "../index.js"

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

async function pickOneGen3BatteryId(clients: Awaited<ReturnType<typeof createKdbClients>>): Promise<string> {
  const base = await queryBatteryBaseStatus({
    clients,
    generation: "gen3",
    query: { pageNum: 1, pageSize: 1 },
  })
  const id = base.rows[0]?.batteryId
  if (!id) {
    throw new Error("[gen3] 无法从 batteryBase 列表中获取 batteryId")
  }
  return id
}

async function main(): Promise<void> {
  const clients = await createKdbClients()
  const client = clients.getClient("gen3")

  const end = new Date(process.env.KDB_END_TIME?.trim() || Date.now())
  const start = new Date(process.env.KDB_START_TIME?.trim() || end.getTime() - 24 * 60 * 60 * 1000)

  let batteryId = (process.env.KDB_BATTERY_ID ?? process.env.KDB_GEN3_BATTERY_ID ?? "").trim()
  if (!batteryId) {
    batteryId = await pickOneGen3BatteryId(clients)
    process.stdout.write(`[gen3] pick batteryId: ${batteryId}\n`)
  }

  const res = await client.request<any>({
    path: "/managekdb/kdbReportBatteryLog/list",
    method: "GET",
    query: {
      pageNum: 1,
      pageSize: 20,
      batteryId,
      params: {
        beginLogTime: fmt(start),
        endLogTime: fmt(end),
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

