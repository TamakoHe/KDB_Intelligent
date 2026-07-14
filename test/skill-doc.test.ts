import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

test("SKILL.md covers every public CLI workflow", async () => {
  const skill = await fs.readFile(new URL("../SKILL.md", import.meta.url), "utf8")
  const packageJson = JSON.parse(
    await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { files?: string[] }
  assert.match(skill, /^---\nname: kdb-battery-cli\ndescription: .+\n---\n/)

  for (const command of ["battery status", "battery ready", "battery mode get", "battery command send", "battery parameter get", "battery ota version", "battery ota firmware list", "battery ota firmware current", "battery ota firmware status set", "battery ota firmware status history", "battery ota firmware status rollback", "battery ota inspect", "battery ota start", "battery ota result", "batch status", "batch command send", "batch parameter read", "batch export realtime", "command result", "ready -b", "status -b", "export realtime", "export <type>", "command list", "command send", "parameter list", "parameter read", "parameter write"]) {
    assert.ok(skill.includes(command), `SKILL.md 缺少 CLI 工作流: ${command}`)
  }

  for (const exportType of [
    "batteryBase",
    "latestBatteryTable",
    "nettyLog",
    "statusNettyLog",
    "bluetoothCommandTasks",
    "realtimeMsgLog",
    "reportBatteryLog",
    "cycle01MsgLog",
    "statusCommandLog",
  ]) {
    assert.ok(skill.includes(`\`${exportType}\``), `SKILL.md 缺少导出类型: ${exportType}`)
  }

  assert.match(skill, /not a test command/)
  assert.match(skill, /confirmationToken/)
  assert.match(skill, /QUEUED_FOR_APP/)
  assert.match(skill, /Mixed Gen2\/Gen3 batches/)
  assert.match(skill, /physical device effect remains unverified/)
  assert.match(skill, /single-battery 4G OTA/)
  assert.match(skill, /firmware upload/)
  assert.match(skill, /--firmware-version/)
  assert.match(skill, /--firmware-name/)
  assert.match(skill, /update this `SKILL\.md` in the same change/)
  assert.ok(packageJson.files?.includes("SKILL.md"), "npm 打包清单必须包含 SKILL.md")
})
