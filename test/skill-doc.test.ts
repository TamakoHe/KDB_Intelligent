import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

test("SKILL.md covers every public CLI workflow", async () => {
  const skill = await fs.readFile(new URL("../SKILL.md", import.meta.url), "utf8")
  const packageJson = JSON.parse(
    await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { files?: string[] }
  assert.match(skill, /^---\nname: kdb-battery-cli\ndescription: .+\n---\n/)

  for (const command of ["ready -b", "status -b", "export realtime", "export <type>"]) {
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

  assert.match(skill, /Never simulate command readiness by sending a test command/)
  assert.match(skill, /complete battery-base row/)
  assert.match(skill, /complete `details` object/)
  assert.match(skill, /detailFieldLabels/)
  assert.match(skill, /Both Gen2 and Gen3/)
  assert.match(skill, /Update this `SKILL\.md` in the same change/)
  assert.ok(packageJson.files?.includes("SKILL.md"), "npm 打包清单必须包含 SKILL.md")
})
