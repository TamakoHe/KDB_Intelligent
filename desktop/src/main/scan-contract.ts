import { z } from "zod"

const SCAN_FIELDS = new Set([
  "batteryId", "generation", "batteryStatus", "faultStatus", "chargeDischargeStatus", "workingModeStatus", "systemOperatingStatus",
  "logTime", "msgId", "msgType", "msgStatus", "current", "totalBatteryVoltage", "residualElectricQuantity", "cellTemperature", "boxTemperature",
  "mosTemperature", "ptcTemperature1", "ptcTemperature2", "dischargeMosTemperature", "chargeMosTemperature", "heatingFilmTemperature",
  "motherboardTemperature", "positivePoleTemperature", "negativePoleTemperature",
])
const filter = z.object({
  field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,50}$/).refine((field) => SCAN_FIELDS.has(field), "不支持的扫描字段"),
  operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in"]),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()])).min(1).max(100)]),
})

export const scanRequestSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
  purpose: z.string().trim().min(1).max(160),
  source: z.enum(["api", "local", "both"]).default("both"),
  generations: z.array(z.enum(["gen2", "gen3"])).min(1).max(2).default(["gen2", "gen3"]),
  start: z.string().min(1).max(40),
  end: z.string().min(1).max(40),
  filters: z.array(filter).max(20).default([]),
  exportDetails: z.boolean().default(true),
})

export const sqlRequestSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
  purpose: z.string().trim().min(1).max(160),
  sql: z.string().trim().min(1).max(64 * 1024),
})

export type ScanRequest = z.infer<typeof scanRequestSchema>
export type SqlRequest = z.infer<typeof sqlRequestSchema>
