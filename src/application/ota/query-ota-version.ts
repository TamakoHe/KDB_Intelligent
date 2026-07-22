import type { KdbApiClients } from "../../index.js"
import { queryBatteryStatusById } from "../status/query-battery-by-id.js"
import { normalizeOtaTarget } from "./list-ota-firmware.js"
import type { OtaVersionSnapshot } from "../../domain/ota/ota-types.js"
import type { DataSource } from "../../core/data-source.js"

export async function queryOtaVersion(args: { clients: KdbApiClients; batteryId: string; generation?: "gen2" | "gen3"; source?: DataSource }): Promise<OtaVersionSnapshot & { found: boolean; source?: "api" | "local"; isHistorical?: true; asOf?: string | null; fallbackFrom?: "api-empty" }> {
  const target = normalizeOtaTarget(args.clients, args.batteryId, args.generation)
  const result = await queryBatteryStatusById({ clients: args.clients, ...target, ...(args.source ? { source: args.source } : {}) })
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
    ...(result.source ? { source: result.source } : {}),
    ...(result.isHistorical ? { isHistorical: true as const, asOf: result.asOf ?? null } : {}),
    ...(result.fallbackFrom ? { fallbackFrom: result.fallbackFrom } : {}),
  }
}
