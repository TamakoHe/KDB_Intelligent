import process from "process"
import { createKdbClients, exportExcel, queryBatteryBaseStatus } from "../index.js"
import { listGen2RealtimeMsgLog } from "../domain/gen2/logs/hckd-realtime-msg-log-api.js"
import { listGen3ReportBatteryLog } from "../domain/gen3/logs/kdb-report-battery-log-api.js"
import { listGen3Cycle01MsgLog } from "../domain/gen3/logs/kdb-cycle01-msg-log-api.js"

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value
  if (typeof value === "string" && value.trim()) {
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

async function pickOneGen3BatteryId(clients: Awaited<ReturnType<typeof createKdbClients>>): Promise<string> {
  const client = clients.getClient("gen3")
  const res = await listGen3ReportBatteryLog(client, { pageNum: 1, pageSize: 1 })
  const row = res.data?.rows?.[0]
  const batteryId = typeof row?.batteryId === "string" ? row.batteryId : ""
  if (!batteryId.trim()) {
    throw new Error("[gen3] 无法自动挑选 batteryId（kdbReportBatteryLog/list 返回为空）")
  }
  return batteryId.trim()
}

async function pickOneGen2BatteryId(clients: Awaited<ReturnType<typeof createKdbClients>>): Promise<string> {
  const res = await queryBatteryBaseStatus({
    clients,
    generation: "gen2",
    query: { pageNum: 1, pageSize: 1 },
  })
  const batteryId = typeof res.rows[0]?.batteryId === "string" ? res.rows[0].batteryId : ""
  if (!batteryId.trim()) {
    throw new Error("[gen2] 无法自动挑选 batteryId（hckdBatteryBase/list 返回为空）")
  }
  return batteryId.trim()
}

function resolveGeneration(batteryId: string): "gen2" | "gen3" {
  const c = batteryId.trim().charAt(0)
  if (c === "4" || c === "6") return "gen3"
  return "gen2"
}

function readPreferredGeneration(): "gen2" | "gen3" | undefined {
  const value = (process.env.KDB_GENERATION ?? "").trim().toLowerCase()
  if (value === "gen2" || value === "gen3") return value
  return undefined
}

async function main(): Promise<void> {
  const clients = await createKdbClients()

  const hours = Math.max(1, Number(process.env.KDB_HOURS ?? "24") || 24)
  const end = new Date(process.env.KDB_END_TIME?.trim() || Date.now())
  const start = new Date(process.env.KDB_START_TIME?.trim() || end.getTime() - hours * 60 * 60 * 1000)

  const preferredGeneration = readPreferredGeneration()
  let batteryId = (process.env.KDB_BATTERY_ID ?? "").trim()
  if (!batteryId) {
    const pickedGeneration = preferredGeneration ?? "gen2"
    batteryId =
      pickedGeneration === "gen2"
        ? await pickOneGen2BatteryId(clients)
        : await pickOneGen3BatteryId(clients)
    process.stdout.write(`[auto] pick ${pickedGeneration} batteryId=${batteryId}\n`)
  }

  const generation = resolveGeneration(batteryId)
  if (preferredGeneration && preferredGeneration !== generation) {
    throw new Error(`KDB_GENERATION=${preferredGeneration} 与 batteryId=${batteryId} 推断代际=${generation} 不一致`)
  }

  if (generation === "gen2") {
    const client = clients.getClient("gen2")
    const query = {
      pageNum: 1,
      pageSize: 1,
      batteryId,
      params: {
        beginCreateTime: fmt(start),
        endCreateTime: fmt(end),
      },
    }
    const listRes = await listGen2RealtimeMsgLog(client, query)
    const total = toNumber(listRes.data?.total) ?? 0
    process.stdout.write(`[gen2] realtimeMsgLog last${hours}h total=${total}\n`)

    const outputPath = (
      process.env.KDB_OUTPUT_PATH ?? `out/gen2-realtimeMsgLog-${batteryId}-last${hours}h.xlsx`
    ).trim()

    const r = await exportExcel({
      clients,
      generation: "gen2",
      type: "realtimeMsgLog",
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
    return
  }

  const client = clients.getClient("gen3")
  const query = {
    pageNum: 1,
    pageSize: 1,
    batteryId,
    params: {
      beginLogTime: fmt(start),
      endLogTime: fmt(end),
    },
  }
  const listRes = await listGen3Cycle01MsgLog(client, query)
  const total = toNumber(listRes.data?.total) ?? 0
  process.stdout.write(`[gen3] cycle01MsgLog last${hours}h total=${total}\n`)

  const outputPath = (process.env.KDB_OUTPUT_PATH ?? `out/gen3-cycle01MsgLog-${batteryId}-last${hours}h.xlsx`).trim()

  const r = await exportExcel({
    clients,
    generation: "gen3",
    type: "cycle01MsgLog",
    query,
    outputPath,
  })

  process.stdout.write(`${r.outputPath}\n`)
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err)
  process.stderr.write(`${msg}\n`)
  process.exitCode = 1
})
