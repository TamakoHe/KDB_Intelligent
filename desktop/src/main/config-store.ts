import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import dgram from "node:dgram"
import path from "node:path"
import * as toml from "@iarna/toml"
import mysql from "mysql2/promise"
import type { KdbConfigFiles, LocalDatabaseConnectionTest } from "../shared.js"

export class ConfigStore {
  readonly configRoot: string
  private readonly publicPath: string
  private readonly localPath: string

  constructor(userDataPath: string, private readonly templateRoot: string) {
    this.configRoot = path.join(userDataPath, "kdb-config")
    this.publicPath = path.join(this.configRoot, "config", "kdb.toml")
    this.localPath = path.join(this.configRoot, "config", "kdb.local.toml")
  }

  async ensure(): Promise<void> {
    await mkdir(path.dirname(this.publicPath), { recursive: true })
    await this.copyIfMissing(path.join(this.templateRoot, "config", "kdb.toml"), this.publicPath)
    await this.copyIfMissing(path.join(this.templateRoot, "config", "kdb.local.example.toml"), this.localPath)
  }

  async read(): Promise<KdbConfigFiles> {
    await this.ensure()
    return {
      publicToml: await readFile(this.publicPath, "utf8"),
      localToml: await readFile(this.localPath, "utf8"),
      configRoot: this.configRoot,
    }
  }

  async save(value: Pick<KdbConfigFiles, "publicToml" | "localToml">): Promise<KdbConfigFiles> {
    await this.ensure()
    await Promise.all([
      writeFile(this.publicPath, value.publicToml, "utf8"),
      writeFile(this.localPath, value.localToml, "utf8"),
    ])
    return this.read()
  }

  async testLocalDatabase(localToml: string): Promise<LocalDatabaseConnectionTest> {
    let local: Record<string, unknown> | undefined
    try {
      const parsed = toml.parse(localToml) as { database?: { local?: Record<string, unknown> } }
      local = parsed.database?.local
    } catch (error) {
      return { configured: false, ok: false, message: `kdb.local.toml 格式错误：${messageOf(error)}` }
    }
    const host = stringValue(local?.host)
    const port = numberValue(local?.port) ?? 3306
    const user = stringValue(local?.user)
    const password = stringValue(local?.password) ?? ""
    const database = stringValue(local?.database) ?? "kadianbao"
    if (!host || !user) return { configured: false, ok: false, host, port, database, message: "未配置 [database.local] 的 host 或 user。" }

    try {
      // Keep this operation in the long-lived GUI process. macOS records local
      // network permission after an actual local-network operation; a short-
      // lived CLI child can exit before the system presents the prompt.
      await primeLocalNetworkPermission(host, port)
      const connection = await mysql.createConnection({ host, port, user, password, database, connectTimeout: 3_000 })
      try {
        await connection.query("SELECT 1")
      } finally {
        await connection.end()
      }
      return { configured: true, ok: true, host, port, database, message: "已成功连接本地历史库（只读连通性验证）。" }
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String((error as { code?: unknown }).code ?? "") : undefined
      const permissionHint = code === "EHOSTUNREACH"
        ? "。请确认系统设置 → 隐私与安全性 → 本地网络中已允许 KDB Copilot；若已允许，再检查当前网络能否访问该主机。"
        : ""
      return { configured: true, ok: false, host, port, database, ...(code ? { errorCode: code } : {}), message: `连接失败：${messageOf(error)}${permissionHint}` }
    }
  }

  private async copyIfMissing(source: string, destination: string): Promise<void> {
    try {
      await access(destination)
    } catch {
      await copyFile(source, destination)
    }
  }
}

function primeLocalNetworkPermission(host: string, port: number): Promise<void> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4")
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      socket.close(() => resolve())
    }
    socket.once("connect", finish)
    socket.once("error", finish)
    setTimeout(finish, 750).unref()
    try {
      socket.connect(port, host)
    } catch {
      finish()
    }
  })
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
