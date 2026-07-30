import mysql, { type Pool, type PoolOptions, type RowDataPacket } from "mysql2/promise"
import type { RuntimeConfig } from "../../core/config/index.js"
import type { ExportType } from "../../application/export/export-excel.js"

export type LocalGeneration = "gen2" | "gen3"
export type LocalRow = Record<string, unknown>
export type LocalFilterOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in"
export type LocalFilter = { field: string; operator: LocalFilterOperator; value: string | number | boolean | Array<string | number> }
export type LocalHistoryTable = { schema: string; table: string; generation: LocalGeneration; batteryId: string }

export interface LocalSqlExecutor {
  query(sql: string, values?: unknown[]): Promise<[RowDataPacket[], unknown]>
  end?(): Promise<void>
}

export class LocalHistoryRepository {
  constructor(private readonly sql: LocalSqlExecutor) {}

  async close(): Promise<void> {
    await this.sql.end?.()
  }

  async executeReadOnly(sql: string, values: unknown[] = []): Promise<LocalRow[]> {
    const [rows] = await this.sql.query(sql, values)
    return rows as LocalRow[]
  }

  async getBase(generation: LocalGeneration, batteryId: string): Promise<LocalRow | null> {
    const [rows] = await this.sql.query(
      `SELECT * FROM ${baseTable(generation)} WHERE \`battery_id\` = ? ORDER BY \`update_time\` DESC LIMIT 1`,
      [normalizeBatteryId(batteryId)],
    )
    return rows[0] ? camelCaseRow(rows[0] as LocalRow) : null
  }

  async listBatteryBase(args: { generation: LocalGeneration; filters?: LocalFilter[]; start?: string; end?: string; limit: number }): Promise<LocalRow[]> {
    const conditions: string[] = []
    const values: unknown[] = []
    for (const filter of args.filters ?? []) {
      const column = baseFilterColumn(args.generation, filter.field)
      if (!column) throw new Error(`本地高级分析不支持基础表字段 ${filter.field}`)
      appendFilter(conditions, values, column, filter)
    }
    if (args.start) {
      conditions.push("`update_time` >= ?")
      values.push(args.start)
    }
    if (args.end) {
      conditions.push("`update_time` <= ?")
      values.push(args.end)
    }
    values.push(args.limit)
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : ""
    const [rows] = await this.sql.query(
      `SELECT * FROM ${baseTable(args.generation)}${where} ORDER BY \`update_time\` DESC LIMIT ?`,
      values,
    )
    return rows.map((row) => camelCaseRow(row as LocalRow))
  }

  async getLatestRealtime(generation: LocalGeneration, batteryId: string): Promise<LocalRow | null> {
    const [rows] = await this.sql.query(
      `SELECT * FROM ${detailTable(generation, batteryId)} ORDER BY \`log_time\` DESC LIMIT 1`,
    )
    return rows[0] ? camelCaseRow(rows[0] as LocalRow) : null
  }

  async listRealtime(args: { generation: LocalGeneration; batteryId: string; start: string; end: string; maxRows?: number; filters?: LocalFilter[] }): Promise<LocalRow[]> {
    const conditions = ["`log_time` >= ?", "`log_time` <= ?"]
    const values: unknown[] = [args.start, args.end]
    for (const filter of args.filters ?? []) {
      const column = detailFilterColumn(filter.field)
      if (!column) throw new Error(`本地高级分析不支持历史字段 ${filter.field}`)
      appendFilter(conditions, values, column, filter)
    }
    const limit = args.maxRows === undefined ? "" : " LIMIT ?"
    if (args.maxRows !== undefined) values.push(args.maxRows)
    const [rows] = await this.sql.query(
      `SELECT * FROM ${detailTable(args.generation, args.batteryId)} WHERE ${conditions.join(" AND ")} ORDER BY \`log_time\` ASC${limit}`,
      values,
    )
    return rows.map((row) => camelCaseRow(row as LocalRow))
  }

  async listHistoryTables(generations: LocalGeneration[]): Promise<LocalHistoryTable[]> {
    const wanted = [...new Set(generations)]
    const clauses: string[] = []
    const values: unknown[] = []
    if (wanted.includes("gen2")) {
      clauses.push("(`table_schema` = ? AND `table_name` REGEXP ?)")
      values.push("newenergy-battery", "^hckd_lihe_msg_log_[0-9A-Fa-f]{8}$")
    }
    if (wanted.includes("gen3")) {
      clauses.push("(`table_schema` IN (?, ?) AND `table_name` REGEXP ?)")
      values.push("kadianbao-battery04", "kadianbao-battery06", "^kdb_cycle0[46]_msg_log_[0-9A-Fa-f]{8}$")
    }
    if (clauses.length === 0) return []
    const [rows] = await this.sql.query(
      `SELECT \`table_schema\`, \`table_name\` FROM \`information_schema\`.\`tables\` WHERE ${clauses.join(" OR ")} ORDER BY \`table_schema\`, \`table_name\``,
      values,
    )
    const result: LocalHistoryTable[] = []
    for (const row of rows as LocalRow[]) {
      const schema = String(row.table_schema ?? "")
      const table = String(row.table_name ?? "")
      const match = table.match(/(?:hckd_lihe_msg_log_|kdb_cycle(?:04|06)_msg_log_)([0-9A-Fa-f]{8})$/)
      if (!match) continue
      const batteryId = normalizeBatteryId(match[1]!)
      const generation: LocalGeneration = schema === "newenergy-battery" ? "gen2" : "gen3"
      result.push({ schema, table, generation, batteryId })
    }
    return result
  }

  async listExport(args: {
    generation: LocalGeneration
    type: ExportType
    batteryId?: string
    start?: string
    end?: string
    maxRows?: number
  }): Promise<LocalRow[]> {
    const table = exportTable(args.generation, args.type, args.batteryId)
    if (args.type === "latestBatteryTable") {
      const [rows] = await this.sql.query(
        `SELECT * FROM ${table} ORDER BY \`log_time\` DESC LIMIT 1`,
      )
      return rows.map((row) => camelCaseRow(row as LocalRow))
    }
    const conditions: string[] = []
    const values: unknown[] = []
    if (args.batteryId) {
      conditions.push("`battery_id` = ?")
      values.push(normalizeBatteryId(args.batteryId))
    }
    if (args.start && args.end && isLogExport(args.type)) {
      conditions.push("`log_time` >= ?", "`log_time` <= ?")
      values.push(args.start, args.end)
    }
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : ""
    const order = isLogExport(args.type) ? " ORDER BY `log_time` ASC" : ""
    const limit = args.maxRows === undefined ? "" : " LIMIT ?"
    if (args.maxRows !== undefined) values.push(args.maxRows)
    const [rows] = await this.sql.query(`SELECT * FROM ${table}${where}${order}${limit}`, values)
    return rows.map((row) => camelCaseRow(row as LocalRow))
  }

  async listParameterDefinitions(args: { generation: LocalGeneration; search?: string }): Promise<LocalRow[]> {
    const values: unknown[] = []
    const where = args.search?.trim()
      ? (values.push(`%${args.search.trim()}%`), " WHERE `parameter_name` LIKE ?")
      : ""
    const [rows] = await this.sql.query(
      `SELECT * FROM ${parameterTable(args.generation)}${where} ORDER BY \`parameter_id\` ASC`,
      values,
    )
    return rows.map((row) => camelCaseRow(row as LocalRow))
  }

  async listFirmwares(args: { generation: LocalGeneration; firmwareVersion?: string; firmwareName?: string }): Promise<LocalRow[]> {
    const conditions: string[] = []
    const values: unknown[] = []
    if (args.firmwareVersion?.trim()) {
      conditions.push("`firmware_version` = ?")
      values.push(args.firmwareVersion.trim())
    }
    if (args.firmwareName?.trim()) {
      conditions.push("`firmware_name` LIKE ?")
      values.push(`%${args.firmwareName.trim()}%`)
    }
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""
    const [rows] = await this.sql.query(`SELECT * FROM ${firmwareTable(args.generation)}${where} ORDER BY \`id\` DESC`, values)
    return rows.map((row) => camelCaseRow(row as LocalRow))
  }
}

const repositoryByConfig = new WeakMap<object, LocalHistoryRepository>()
const repositoryConfigs = new Set<object>()

export function createLocalHistoryRepository(config: RuntimeConfig): LocalHistoryRepository {
  const existing = repositoryByConfig.get(config)
  if (existing) return existing
  const settings = config.database?.local
  if (!settings) throw new Error("未配置 [database.local]；请在已忽略的 config/kdb.local.toml 中配置本地历史库")
  const options: PoolOptions = {
    host: settings.host,
    port: settings.port,
    user: settings.user,
    password: settings.password,
    database: settings.database,
    connectionLimit: settings.connection_limit,
    enableKeepAlive: true,
    waitForConnections: true,
  }
  const repository = new LocalHistoryRepository(mysql.createPool(options) as unknown as Pool)
  repositoryByConfig.set(config, repository)
  repositoryConfigs.add(config)
  return repository
}

/** Close pools at an application boundary (CLI shutdown, worker teardown, etc.). */
export async function closeLocalHistoryRepositories(): Promise<void> {
  const configs = [...repositoryConfigs]
  repositoryConfigs.clear()
  await Promise.all(configs.map(async (config) => {
    const repository = repositoryByConfig.get(config)
    repositoryByConfig.delete(config)
    await repository?.close()
  }))
}

export function normalizeBatteryId(value: string): string {
  const batteryId = value.trim().toUpperCase()
  if (!/^[0-9A-F]{8}$/.test(batteryId)) throw new Error("本地历史查询要求 8 位十六进制电池编号")
  return batteryId
}

export function baseTable(generation: LocalGeneration): string {
  return generation === "gen2" ? "`newenergy`.`hckd_battery_base`" : "`kadianbao`.`kdb_battery_base`"
}

export function detailTable(generation: LocalGeneration, batteryId: string): string {
  const id = normalizeBatteryId(batteryId).toLowerCase()
  if (generation === "gen2") return `\`newenergy-battery\`.\`hckd_lihe_msg_log_${id}\``
  if (id.startsWith("4")) return `\`kadianbao-battery04\`.\`kdb_cycle04_msg_log_${id}\``
  if (id.startsWith("6")) return `\`kadianbao-battery06\`.\`kdb_cycle06_msg_log_${id}\``
  throw new Error(`Gen3 本地历史库不支持编号前缀 ${id.charAt(0)}`)
}

function parameterTable(generation: LocalGeneration): string {
  return generation === "gen2" ? "`newenergy`.`hckd_parameter_base`" : "`kadianbao`.`kdb_parameter_base`"
}

function firmwareTable(generation: LocalGeneration): string {
  return generation === "gen2" ? "`newenergy`.`hckd_firmware_base`" : "`kadianbao`.`kdb_firmware_base`"
}

function exportTable(generation: LocalGeneration, type: ExportType, batteryId?: string): string {
  if (type === "batteryBase") return baseTable(generation)
  if (generation === "gen2") {
    if (type === "latestBatteryTable" || type === "realtimeMsgLog") {
      if (!batteryId) throw new Error(`${type} 使用 --source local 时必须提供 --battery-id，避免扫描全部按电池分表`) 
      return detailTable("gen2", batteryId)
    }
    if (type === "nettyLog") return "`newenergy`.`hckd_netty_log`"
    if (type === "statusNettyLog") return "`newenergy`.`hckd_status_netty_log`"
    if (type === "bluetoothCommandTasks") return "`newenergy`.`hckd_bluetooth_command_tasks`"
  } else {
    if (type === "cycle01MsgLog") {
      if (!batteryId) throw new Error("cycle01MsgLog 使用 --source local 时必须提供 --battery-id，避免扫描全部按电池分表")
      return detailTable("gen3", batteryId)
    }
    if (type === "reportBatteryLog") return "`kadianbao`.`kdb_report_battery_log`"
    if (type === "statusCommandLog") return "`kadianbao`.`kdb_status_command_log`"
  }
  throw new Error(`${generation} 本地历史库不支持导出类型 ${type}`)
}

const BASE_FILTER_FIELDS: Record<LocalGeneration, Record<string, string>> = {
  gen2: {
    batteryId: "battery_id", serialNumber: "serial_number", batteryDataId: "battery_data_id", batteryType: "battery_type", batteryStatus: "battery_status", lte4gStatus: "lte4g_status", bluetoothStatus: "bluetooth_status",
    batteryVersion: "battery_version", firmwareVersion: "battery_version", warrantyStatus: "warranty_status", agentName: "agent_name", batteryModelName: "battery_model_name",
    batteryLabel: "battery_label", useTime: "use_time", storageTime: "storage_time", deliveryTime: "delivery_time", jwProvince: "jw_province", jwCity: "jw_city", jwArea: "jw_area", jwVillage: "jw_village", updateTime: "update_time", createTime: "create_time",
  },
  gen3: {
    batteryId: "battery_id", serialNumber: "serial_number", batteryDataId: "battery_data_id", batteryType: "battery_type", batteryStatus: "battery_status", faultStatus: "fault_status", chargeDischargeStatus: "charge_discharge_status",
    lte4gStatus: "lte4g_status", bluetoothStatus: "bluetooth_status", appVersion: "app_version", warrantyStatus: "warranty_status",
    firmwareVersion: "app_version", agentName: "agent_name", batteryModelName: "battery_model_name", batteryLabel: "battery_label", useTime: "use_time", storageTime: "storage_time", deliveryTime: "delivery_time", jwProvince: "jw_province", jwCity: "jw_city", jwArea: "jw_area", jwVillage: "jw_village", updateTime: "update_time", createTime: "create_time",
  },
}

function baseFilterColumn(generation: LocalGeneration, field: string): string | undefined {
  const column = BASE_FILTER_FIELDS[generation][field]
  return column ? `\`${column}\`` : undefined
}

const DETAIL_FILTER_FIELDS = new Set([
  "batteryId", "logTime", "faultStatus", "chargeDischargeStatus", "current", "totalBatteryVoltage", "residualElectricQuantity",
  "cellTemperature", "boxTemperature", "mosTemperature", "ptcTemperature1", "ptcTemperature2", "dischargeMosTemperature",
  "chargeMosTemperature", "heatingFilmTemperature", "motherboardTemperature", "positivePoleTemperature", "negativePoleTemperature",
  "workingModeStatus", "systemOperatingStatus", "batteryStatus", "msgId", "msgType", "msgStatus",
])

function detailFilterColumn(field: string): string | undefined {
  if (!DETAIL_FILTER_FIELDS.has(field)) return undefined
  return `\`${camelToSnake(field)}\``
}

function camelToSnake(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

function appendFilter(conditions: string[], values: unknown[], column: string, filter: LocalFilter): void {
  if (filter.operator === "in") {
    if (!Array.isArray(filter.value) || filter.value.length === 0 || filter.value.length > 100) throw new Error("in 筛选值必须是 1~100 项数组")
    conditions.push(`${column} IN (${filter.value.map(() => "?").join(", ")})`)
    values.push(...filter.value)
    return
  }
  if (filter.operator === "contains") {
    if (typeof filter.value !== "string") throw new Error("contains 筛选值必须是字符串")
    conditions.push(`${column} LIKE ?`)
    values.push(`%${filter.value}%`)
    return
  }
  const operators: Record<Exclude<LocalFilterOperator, "in" | "contains">, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }
  conditions.push(`${column} ${operators[filter.operator]} ?`)
  values.push(filter.value)
}

function isLogExport(type: ExportType): boolean {
  return type !== "batteryBase"
}

function camelCaseRow(row: LocalRow): LocalRow {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [snakeToCamel(key), value]))
}

function snakeToCamel(value: string): string {
  return value.replace(/_([a-zA-Z])/g, (_, letter: string) => letter.toUpperCase())
}
