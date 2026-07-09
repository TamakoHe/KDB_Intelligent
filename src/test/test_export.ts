import process from "process"
import { createKdbClients, exportExcel, queryBatteryBaseStatus } from "../index.js"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRetries<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < 5; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      process.stderr.write(`${label} failed (attempt ${i + 1}/5): ${msg}\n`)
      await sleep(1500 * (i + 1))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

async function pickOneBatteryId(
  clients: Awaited<ReturnType<typeof createKdbClients>>,
  generation: "gen2" | "gen3",
): Promise<string | undefined> {
  const base = await withRetries(`pickOneBatteryId(${generation})`, () =>
    queryBatteryBaseStatus({
      clients,
      generation,
      query: { pageNum: 1, pageSize: 1 },
    }),
  )
  return base.rows[0]?.batteryId
}

async function main(): Promise<void> {
  process.stdout.write(`createKdbClients...\n`)
  const clients = await createKdbClients()
  process.stdout.write(`createKdbClients OK\n`)

  const skipGen2 = (process.env.KDB_SKIP_GEN2 ?? "").trim() === "1"
  const skipGen3 = (process.env.KDB_SKIP_GEN3 ?? "").trim() === "1"
  const requireGen2 = (process.env.KDB_REQUIRE_GEN2 ?? "").trim() === "1"
  const requireGen3 = (process.env.KDB_REQUIRE_GEN3 ?? "").trim() === "1"

  let failed = false

  let gen2BatteryId = process.env.KDB_GEN2_BATTERY_ID?.trim()
  if (!gen2BatteryId && !skipGen2) {
    process.stdout.write(`pickOneBatteryId(gen2)...\n`)
    try {
      gen2BatteryId = await pickOneBatteryId(clients, "gen2")
      process.stdout.write(`pickOneBatteryId(gen2) OK: ${gen2BatteryId ?? "(none)"}\n`)
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      process.stderr.write(`pickOneBatteryId(gen2) FAILED: ${msg}\n`)
      process.stderr.write(`已跳过 gen2 导出；你可以手动设置环境变量 KDB_GEN2_BATTERY_ID=9552D48A 再重试。\n`)
      if (requireGen2) {
        failed = true
      }
    }
  }

  let gen3BatteryId = process.env.KDB_GEN3_BATTERY_ID?.trim()
  if (!gen3BatteryId && !skipGen3) {
    process.stdout.write(`pickOneBatteryId(gen3)...\n`)
    try {
      gen3BatteryId = await pickOneBatteryId(clients, "gen3")
      process.stdout.write(`pickOneBatteryId(gen3) OK: ${gen3BatteryId ?? "(none)"}\n`)
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      process.stderr.write(`pickOneBatteryId(gen3) FAILED: ${msg}\n`)
      process.stderr.write(`已跳过 gen3 导出；你可以手动设置环境变量 KDB_GEN3_BATTERY_ID=40470BE3 再重试。\n`)
      if (requireGen3) {
        failed = true
      }
    }
  }

  const results: Array<{ generation: "gen2" | "gen3"; type: any; outputPath: string }> = []

  async function runExport(args: {
    generation: "gen2" | "gen3"
    type: any
    query: Record<string, unknown>
  }): Promise<void> {
    process.stdout.write(`[${args.generation}] start export ${String(args.type)}\n`)
    try {
      results.push({
        generation: args.generation,
        type: args.type,
        outputPath: (
          await withRetries(`[${args.generation}] export ${String(args.type)}`, () =>
            exportExcel({
              clients,
              generation: args.generation,
              type: args.type,
              query: args.query,
            }),
          )
        ).outputPath,
      })
    } catch (err) {
      failed = true
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      process.stderr.write(`[${args.generation}] export ${String(args.type)} FAILED: ${msg}\n`)
    }
  }

  if (!skipGen3 && gen3BatteryId) {
    await runExport({ generation: "gen3", type: "batteryBase", query: { batteryId: gen3BatteryId } })
    await runExport({
      generation: "gen3",
      type: "reportBatteryLog",
      query: { batteryId: gen3BatteryId },
    })
    await runExport({ generation: "gen3", type: "cycle01MsgLog", query: { batteryId: gen3BatteryId } })
    await runExport({ generation: "gen3", type: "statusCommandLog", query: { batteryId: gen3BatteryId } })
  }

  if (!skipGen2 && gen2BatteryId) {
    await runExport({ generation: "gen2", type: "batteryBase", query: { batteryId: gen2BatteryId } })
    await runExport({ generation: "gen2", type: "nettyLog", query: { batteryId: gen2BatteryId } })
    await runExport({ generation: "gen2", type: "statusNettyLog", query: { batteryId: gen2BatteryId } })
    await runExport({
      generation: "gen2",
      type: "bluetoothCommandTasks",
      query: { batteryId: gen2BatteryId },
    })
  }

  if (!skipGen2) {
    const likeBatteryId = (process.env.KDB_GEN2_LIKE_BATTERY_ID ?? gen2BatteryId ?? "").trim()
    if (likeBatteryId) {
      await runExport({
        generation: "gen2",
        type: "latestBatteryTable",
        query: { params: { likeBatteryId } },
      })
    }
  }

  for (const item of results) {
    process.stdout.write(`[${item.generation}] export ${String(item.type)} -> ${item.outputPath}\n`)
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
