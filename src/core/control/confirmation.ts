import { createHmac, timingSafeEqual } from "node:crypto"
import type { RuntimeConfig } from "../config/index.js"

export type ConfirmationAction = {
  kind: "command" | "parameter-write" | "ota"
  generation: "gen2" | "gen3"
  channel: "4g" | "bluetooth"
  batteryId: string
  operation: string
  payload: Record<string, unknown>
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function secret(config: RuntimeConfig, generation: "gen2" | "gen3"): string {
  const value = config.credentials[generation].token_env?.trim()
  if (!value) throw new Error(`${generation} 未配置 Token，无法生成安全确认令牌`)
  return value
}

function signature(action: ConfirmationAction, expiresAt: number, config: RuntimeConfig): string {
  return createHmac("sha256", secret(config, action.generation))
    .update(`kdb-confirm-v1\n${expiresAt}\n${canonical(action)}`)
    .digest("base64url")
}

export function createConfirmationToken(
  action: ConfirmationAction,
  config: RuntimeConfig,
  ttlMs = 5 * 60 * 1000,
): { confirmationToken: string; expiresAt: string } {
  const expiresAt = Date.now() + ttlMs
  return {
    confirmationToken: `${expiresAt}.${signature(action, expiresAt, config)}`,
    expiresAt: new Date(expiresAt).toISOString(),
  }
}

export function verifyConfirmationToken(
  action: ConfirmationAction,
  token: string | undefined,
  config: RuntimeConfig,
): void {
  const required =
    action.kind === "command"
      ? config.confirm.require_for_command
    : action.kind === "parameter-write"
      ? config.confirm.require_for_parameter_write
      : config.confirm.require_for_ota
  if (!required) return
  if (!token) throw new Error("该操作需要 --confirm <预览返回的 confirmationToken>")
  const separator = token.indexOf(".")
  if (separator <= 0) throw new Error("确认令牌格式无效")
  const expiresAt = Number(token.slice(0, separator))
  const actual = token.slice(separator + 1)
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) throw new Error("确认令牌已过期，请重新预览")
  const expected = signature(action, expiresAt, config)
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("确认令牌与本次操作不匹配，请重新预览")
  }
}
