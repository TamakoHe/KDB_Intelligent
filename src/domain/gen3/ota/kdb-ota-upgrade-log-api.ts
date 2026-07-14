import type { KdbSiteClient } from "../../../clients/kdb-site-client.js"
import type { TableDataInfo } from "../../../core/api/table-data.js"

export type Gen3OtaUpgradeLogRow = {
  id?: number
  batteryId?: string
  batteryDataId?: string
  serialNumber?: string
  upgradeVersion?: string
  upgradeStartTime?: string
  upgradeIngTime?: string
  upgradeOverTime?: string
  upgradeDuration?: number
  upgradeStatus?: number | string
  [key: string]: unknown
}

export const listGen3OtaUpgradeLogs = (client: KdbSiteClient, query?: Record<string, unknown>) =>
  client.request<TableDataInfo<Gen3OtaUpgradeLogRow>>({
    path: "/managekdb/kdbOtaUpgradeBaseLog/list",
    method: "GET",
    query: query as never,
  })

