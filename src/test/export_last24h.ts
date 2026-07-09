import process from "process"
import { createKdbClients, exportExcel } from "../index.js"

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

async function main(): Promise<void> {
  const clients = await createKdbClients()

  const batteryId = (process.env.KDB_BATTERY_ID ?? process.env.KDB_GEN2_BATTERY_ID ?? "8F9AE708").trim()
  if (!batteryId) {
    throw new Error("缺少 batteryId，请设置 KDB_BATTERY_ID 或 KDB_GEN2_BATTERY_ID")
  }

  const type = ((process.env.KDB_EXPORT_TYPE ?? "nettyLog").trim() ||
    "nettyLog") as "nettyLog" | "statusNettyLog" | "realtimeMsgLog"

  const end = new Date(process.env.KDB_END_TIME?.trim() || Date.now())
  const start = new Date(process.env.KDB_START_TIME?.trim() || end.getTime() - 24 * 60 * 60 * 1000)

  const outputPath = (process.env.KDB_OUTPUT_PATH ?? `out/gen2-${type}-${batteryId}-last24h.xlsx`).trim()

  const r = await exportExcel({
    clients,
    generation: "gen2",
    type,
    query: {
      batteryId,
      params: {
        beginCreateTime: fmt(start),
        endCreateTime: fmt(end),
      },
    },
    outputPath,
  })

  process.stdout.write(`${r.outputPath}\n`)
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err)
  process.stderr.write(`${msg}\n`)
  process.exitCode = 1
})
