import { z } from "zod"

export const ANALYSIS_PERMISSIONS = ["read.batteryBase", "read.latestStatus", "read.history", "export.realtime"] as const
export type AnalysisPermission = typeof ANALYSIS_PERMISSIONS[number]

export const analysisRequestSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
  purpose: z.string().trim().min(1).max(160),
  script: z.string().min(1).max(32_768),
  source: z.enum(["api", "local", "auto"]).default("auto"),
  permissions: z.array(z.enum(ANALYSIS_PERMISSIONS)).min(1).max(4),
})

export type AnalysisRequest = z.infer<typeof analysisRequestSchema>
export type AnalysisHostMethod = "read.batteries" | "read.latestStatus" | "read.history" | "export.realtime"

export type AnalysisWorkerRun = {
  type: "run"
  request: AnalysisRequest
}

export type AnalysisWorkerMessage =
  | { type: "request"; requestId: string; method: AnalysisHostMethod; args: unknown }
  | { type: "result"; value: unknown }
  | { type: "error"; error: string }

export type AnalysisHostReply = {
  type: "response"
  requestId: string
  ok: boolean
  data?: unknown
  error?: string
}
