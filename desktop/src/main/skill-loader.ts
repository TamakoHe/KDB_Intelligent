import { readFile } from "node:fs/promises"
import path from "node:path"
import { app } from "electron"

function skillPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "kdb-core", "SKILL.md")
  return path.resolve(app.getAppPath(), "..", "SKILL.md")
}

export async function loadKdbSkill(): Promise<string> {
  return readFile(skillPath(), "utf8")
}
