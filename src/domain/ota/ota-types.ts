export type OtaGeneration = "gen2" | "gen3"

export type OtaStatus =
  | "PREVIEW"
  | "SENT"
  | "ACKNOWLEDGED"
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "TIMEOUT"

export type FirmwareDefinition = {
  id?: number | string
  goodsId?: number | string
  serialNumber?: number | string
  firmwareVersion?: string
  firmwareName?: string
  firmwareFileName?: string
  firmwareAsciiName?: string
  firmwareSize?: number | string
  firmwarePath?: string
  firmwareStatus?: number | string
  firmwarePushNum?: number | string
  firmwareType?: number | string
  description?: string
  [key: string]: unknown
}

export type OtaFirmwareStatusChange = {
  firmwareId: string | number
  beforeStatus: string
  afterStatus: string
  beforeFirmware: FirmwareDefinition
  afterFirmware: FirmwareDefinition
}

export type OtaFirmwareStatusHistoryEntry = {
  operationId: string
  createdAt: string
  operation: "SET" | "OTA_ACTIVATE" | "ROLLBACK"
  result: "APPLIED"
  batteryId: string
  generation: OtaGeneration
  changes: OtaFirmwareStatusChange[]
  rollbackOf?: string
}

export type OtaVersionSnapshot = {
  batteryId: string
  generation: OtaGeneration
  currentVersion: string | null
  versionField: "battery_version" | "app_version"
  networkStatus: string | null
  networkTime: string | null
  latestReportTime: string | null
}

export type OtaPreflightResult = {
  canStart: boolean
  batteryId: string
  generation: OtaGeneration
  currentVersion: string | null
  targetVersion: string | null
  allowDowngrade: boolean
  firmwareId: string | number
  firmwareName: string | null
  firmwareStatus: string | null
  firmwareType: string | null
  firmwareSerialNumber: string | null
  batterySerialNumber: string | null
  networkStatus: string | null
  latestReportTime: string | null
  recentDataCount: number | null
  blockedReasons: string[]
  warnings: string[]
}

export type OtaPreviewResult = {
  phase: "PREVIEW"
  status: "PREVIEW"
  batteryId: string
  generation: OtaGeneration
  channel: "4g"
  currentVersion: string | null
  targetFirmware: FirmwareDefinition
  preflight: OtaPreflightResult
  confirmationToken: string
  expiresAt: string
  next: string
}

export type OtaStartResult = {
  phase: "submitted"
  status: "SENT"
  batteryId: string
  generation: OtaGeneration
  channel: "4g"
  sessionId: number
  firmwareId: string | number
  currentVersion: string | null
  targetVersion: string | null
  applied: false
  physicalEffectVerified: false
  message: string
}

export type OtaResult = {
  batteryId: string
  generation: OtaGeneration
  sessionId?: number
  firmwareId?: string | number
  targetVersion?: string | null
  currentVersion: string | null
  status: OtaStatus
  protocolAcknowledged: boolean
  physicalEffectVerified: boolean
  startedAt?: string | null
  finishedAt?: string | null
  durationMs?: number | null
  message: string
  otaLog?: Record<string, unknown> | null
  versionSnapshot: OtaVersionSnapshot
}
