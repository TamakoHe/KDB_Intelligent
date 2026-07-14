import type { KdbApiClients } from "../../index.js"
import { queryBatteryStatusById } from "../status/query-battery-by-id.js"
import { normalizeOtaTarget } from "./list-ota-firmware.js"
import type { OtaVersionSnapshot } from "../../domain/ota/ota-types.js"

export async function queryOtaVersion(args: { clients: KdbApiClients; batteryId: string; generation?: "gen2" | "gen3" }): Promise<OtaVersionSnapshot & { found: boolean }> {
  const target = normalizeOtaTarget(args.clients, args.batteryId, args.generation)
  const result = await queryBatteryStatusById({ clients: args.clients, ...target })
  const details = result.details ?? {}
  return {
    batteryId: target.batteryId,
    generation: target.generation,
    currentVersion: result.summary?.firmwareVersion ?? (String(details[target.generation === "gen2" ? "batteryVersion" : "appVersion"] ?? "") || null),
    versionField: target.generation === "gen2" ? "battery_version" : "app_version",
    networkStatus: result.summary?.networkStatus ?? null,
    networkTime: result.summary?.networkTime ?? null,
    latestReportTime: (result.latestReport?.logTime ?? result.latestRealtime?.logTime ?? null) as string | null,
    found: result.found,
  }
}
