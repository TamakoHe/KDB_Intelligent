import mysql, { type Pool, type PoolOptions, type RowDataPacket } from "mysql2/promise"
import type { RuntimeConfig } from "../../core/config/index.js"
import type { ExportType } from "../../application/export/export-excel.js"

export type LocalGeneration = "gen2" | "gen3"
export type LocalRow = Record<string, unknown>

export interface LocalSqlExecutor {
  query(sql: string, values?: unknown[]): Promise<[RowDataPacket[], unknown]>
  end?(): Promise<void>
}

export class LocalHistoryRepository {
  constructor(private readonly sql: LocalSqlExecutor) {}

  async close(): Promise<void> {
    await this.sql.end?.()
  }

  async getBase(generation: LocalGeneration, batteryId: string): Promise<LocalRow | null> {
    const [rows] = await this.sql.query(
      `SELECT * FROM ${baseTable(generation)} WHERE \`battery_id\` = ? ORDER BY \`update_time\` DESC LIMIT 1`,
      [normalizeBatteryId(batteryId)],
    )
    return rows[0] ? camelCaseRow(rows[0] as LocalRow) : null
  }

  async getLatestRealtime(generation: LocalGeneration, batteryId: string): Promise<LocalRow | null> {
    const [rows] = await this.sql.query(
      `SELECT * FROM ${detailTable(generation, batteryId)} ORDER BY \`log_time\` DESC LIMIT 1`,
    )
    return rows[0] ? camelCaseRow(rows[0] as LocalRow) : null
  }

  async listRealtime(args: { generation: LocalGeneration; batteryId: string; start: string; end: string }): Promise<LocalRow[]> {
    const [rows] = await this.sql.query(
      `SELECT * FROM ${detailTable(args.generation, args.batteryId)} WHERE \`log_time\` >= ? AND \`log_time\` <= ? ORDER BY \`log_time\` ASC`,
      [args.start, args.end],
    )
    return rows.map((row) => camelCaseRow(row as LocalRow))
  }

  async listExport(args: {
    generation: LocalGeneration
    type: ExportType
    batteryId?: string
    start?: string
    end?: string
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
    const [rows] = await this.sql.query(`SELECT * FROM ${table}${where}${order}`, values)
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

function isLogExport(type: ExportType): boolean {
  return type !== "batteryBase"
}

function camelCaseRow(row: LocalRow): LocalRow {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [snakeToCamel(key), value]))
}

function snakeToCamel(value: string): string {
  return value.replace(/_([a-zA-Z])/g, (_, letter: string) => letter.toUpperCase())
}
