import { randomInt } from "node:crypto"
import type { KdbApiClients } from "../../index.js"
import { assertAjaxOk } from "../../core/api/ajax-result.js"
import { createConfirmationToken, verifyConfirmationToken, type ConfirmationAction } from "../../core/control/confirmation.js"
import { sendGen2OtaCommand } from "../../domain/gen2/ota/hckd-firmware-api.js"
import { sendGen3OtaEnter } from "../../domain/gen3/control/kdb-control-api.js"
import type { FirmwareDefinition, OtaFirmwareStatusChange, OtaPreviewResult, OtaStartResult } from "../../domain/ota/ota-types.js"
import { recordOtaFirmwareStatusHistory, updateFirmwareStatus } from "./firmware-status-history.js"
import { inspectOtaPreconditions } from "./inspect-ota-preconditions.js"
import { listOtaFirmware } from "./list-ota-firmware.js"

async function activateFirmware(args: {
  clients: KdbApiClients
  batteryId: string
  generation: "gen2" | "gen3"
  firmware: FirmwareDefinition
}) {
  const listed = await listOtaFirmware({ clients: args.clients, batteryId: args.batteryId, generation: args.generation })
  const serial = String(args.firmware.serialNumber ?? "")
  const sameSeries = listed.firmwares.filter((item) => String(item.serialNumber ?? "") === serial)
  const previous = sameSeries.map((item) => ({ firmware: item, status: String(item.firmwareStatus ?? "") }))
  const changes: OtaFirmwareStatusChange[] = []
  try {
    for (const item of sameSeries) {
      if (String(item.id) !== String(args.firmware.id) && String(item.firmwareStatus) !== "1") {
        const updated = await updateFirmwareStatus({ clients: args.clients, generation: args.generation, firmware: item, status: "1" })
        changes.push({ firmwareId: item.id!, beforeStatus: String(item.firmwareStatus ?? ""), afterStatus: "1", beforeFirmware: item, afterFirmware: updated })
      }
    }
    if (String(args.firmware.firmwareStatus) !== "2") {
      const updated = await updateFirmwareStatus({ clients: args.clients, generation: args.generation, firmware: args.firmware, status: "2" })
      changes.push({ firmwareId: args.firmware.id!, beforeStatus: String(args.firmware.firmwareStatus ?? ""), afterStatus: "2", beforeFirmware: args.firmware, afterFirmware: updated })
    }
  } catch (error) {
    for (const item of previous.filter((entry) => entry.status)) {
      try {
        await updateFirmwareStatus({ clients: args.clients, generation: args.generation, firmware: item.firmware, status: item.status })
      } catch {
        // Preserve the original activation error; a later inspection can report any repair needed.
      }
    }
    throw error
  }
  return { previous, changes, activeFirmwareIds: sameSeries.filter((item) => String(item.id) !== String(args.firmware.id) && String(item.firmwareStatus) === "2").map((item) => item.id) }
}

function actionFor(args: { batteryId: string; generation: "gen2" | "gen3"; firmware: FirmwareDefinition; currentVersion: string | null; preflight: unknown }): ConfirmationAction {
  return {
    kind: "ota",
    generation: args.generation,
    channel: "4g",
    batteryId: args.batteryId,
    operation: "ota-start",
    payload: {
      firmwareId: args.firmware.id,
      firmwareSnapshot: {
        id: args.firmware.id,
        firmwareVersion: args.firmware.firmwareVersion,
        firmwareName: args.firmware.firmwareName,
        firmwarePath: args.firmware.firmwarePath,
        firmwareSize: args.firmware.firmwareSize,
        firmwareStatus: args.firmware.firmwareStatus,
        firmwareType: args.firmware.firmwareType,
        serialNumber: args.firmware.serialNumber,
      },
      firmwareVersion: args.firmware.firmwareVersion,
      firmwareSerialNumber: args.firmware.serialNumber,
      currentVersion: args.currentVersion,
      preflight: args.preflight,
    },
  }
}

export async function startOtaUpgrade(args: {
  clients: KdbApiClients
  batteryId: string
  firmwareId?: string
  firmwareVersion?: string
  firmwareName?: string
  generation?: "gen2" | "gen3"
  confirmationToken?: string
  preflightMinutes?: number
  minDataCount?: number
}): Promise<OtaPreviewResult | OtaStartResult> {
  const checked = await inspectOtaPreconditions(args)
  const action = actionFor({
    batteryId: checked.target.batteryId,
    generation: checked.target.generation,
    firmware: checked.firmware,
    currentVersion: checked.preflight.currentVersion,
    preflight: checked.preflight,
  })
  if (!checked.preflight.canStart) {
    throw new Error(`OTA 前置检查失败：${checked.preflight.blockedReasons.join("；")}`)
  }
  if (!args.confirmationToken) {
    const token = createConfirmationToken(action, args.clients.config)
    return {
      phase: "PREVIEW",
      status: "PREVIEW",
      batteryId: checked.target.batteryId,
      generation: checked.target.generation,
      channel: "4g",
      currentVersion: checked.preflight.currentVersion,
      targetFirmware: checked.firmware,
      preflight: checked.preflight,
      ...token,
      next: "用户明确确认目标固件、版本和前置检查后，使用完全相同参数携带 --confirm 执行",
    }
  }
  verifyConfirmationToken(action, args.confirmationToken, args.clients.config)
  const refreshed = await inspectOtaPreconditions(args)
  if (!refreshed.preflight.canStart) throw new Error(`确认后 OTA 复检失败：${refreshed.preflight.blockedReasons.join("；")}`)
  const changed = refreshed.preflight.currentVersion !== checked.preflight.currentVersion
    || refreshed.preflight.targetVersion !== checked.preflight.targetVersion
    || refreshed.preflight.firmwareSerialNumber !== checked.preflight.firmwareSerialNumber
    || refreshed.preflight.batterySerialNumber !== checked.preflight.batterySerialNumber
    || refreshed.firmware.id !== checked.firmware.id
    || refreshed.firmware.firmwareName !== checked.firmware.firmwareName
    || refreshed.firmware.firmwareVersion !== checked.firmware.firmwareVersion
    || refreshed.firmware.firmwarePath !== checked.firmware.firmwarePath
    || String(refreshed.firmware.firmwareSize ?? "") !== String(checked.firmware.firmwareSize ?? "")
    || String(refreshed.firmware.serialNumber ?? "") !== String(checked.firmware.serialNumber ?? "")
  if (changed) throw new Error("确认后 OTA 版本或硬件匹配条件已变化，请重新预览")

  const activation = await activateFirmware({ clients: args.clients, batteryId: refreshed.target.batteryId, generation: refreshed.target.generation, firmware: refreshed.firmware })
  if (activation.changes.length > 0) {
    await recordOtaFirmwareStatusHistory({ clients: args.clients, batteryId: refreshed.target.batteryId, generation: refreshed.target.generation, changes: activation.changes })
  }
  const sessionId = randomInt(1, 0x7fffffff)
  if (refreshed.target.generation === "gen2") {
    const response = await sendGen2OtaCommand(args.clients.gen2, { batteryId: refreshed.target.batteryId })
    assertAjaxOk({ generation: "gen2", action: "sendOtaEnter", result: response.data })
  } else {
    const response = await sendGen3OtaEnter(args.clients.gen3, { batteryId: refreshed.target.batteryId, sessionId })
    assertAjaxOk({ generation: "gen3", action: "sendOtaEnter", result: response.data })
  }
  return {
    phase: "submitted",
    status: "SENT",
    batteryId: refreshed.target.batteryId,
    generation: refreshed.target.generation,
    channel: "4g",
    sessionId,
    firmwareId: refreshed.firmware.id ?? args.firmwareVersion ?? args.firmwareId ?? "",
    currentVersion: refreshed.preflight.currentVersion,
    targetVersion: refreshed.firmware.firmwareVersion ?? null,
    applied: false,
    physicalEffectVerified: false,
    message: "网站后台已接受 OTA 启动请求；这不等于文件传输或设备升级成功",
  }
}
