import process from "process"
import { createKdbClients, queryBatteryBaseStatus, queryLatestReportStatus } from "../index.js"

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

async function main(): Promise<void> {
  const clients = await createKdbClients()
  const baseQuery = { pageNum: 1, pageSize: 1 }
  const skipGen2 = (process.env.KDB_SKIP_GEN2 ?? "").trim() === "1"
  const skipGen3 = (process.env.KDB_SKIP_GEN3 ?? "").trim() === "1"

  const likeBatteryId = process.env.KDB_GEN2_LIKE_BATTERY_ID?.trim()
  const gen2LatestQuery = likeBatteryId ? { params: { likeBatteryId } } : {}

  for (const generation of ["gen2", "gen3"] as const) {
    if (generation === "gen2" && skipGen2) {
      process.stdout.write(`[gen2] SKIP (KDB_SKIP_GEN2=1)\n`)
      continue
    }
    if (generation === "gen3" && skipGen3) {
      process.stdout.write(`[gen3] SKIP (KDB_SKIP_GEN3=1)\n`)
      continue
    }

    const base = await queryBatteryBaseStatus({ clients, generation, query: baseQuery })
    process.stdout.write(`[${generation}] batteryBase total=${base.total}\n`)
    process.stdout.write(`${safeStringify(base.rows[0] ?? null)}\n`)

    const latest =
      generation === "gen2"
        ? await queryLatestReportStatus({ clients, generation, query: gen2LatestQuery })
        : await queryLatestReportStatus({
            clients,
            generation,
            query: { pageNum: 1, pageSize: 1, orderByColumn: "logTime", isAsc: "desc" },
          })

    process.stdout.write(`[${generation}] latest total=${latest.total}\n`)
    process.stdout.write(`${safeStringify(latest.rows[0] ?? null)}\n`)
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err)
  process.stderr.write(`${msg}\n`)
  process.exitCode = 1
})
