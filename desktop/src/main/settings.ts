import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type { AppSettings, ThemeMode } from "../shared.js"

const DEFAULT_DEEPSEEK_URL = "https://api.deepseek.com"
const DEFAULT_MODEL = "deepseek-v4-flash"

export class SettingsStore {
  private readonly filePath: string

  constructor(private readonly userDataPath: string, private readonly defaultKdbConfigRoot: string) {
    this.filePath = path.join(userDataPath, "settings.json")
  }

  async get(): Promise<AppSettings> {
    try {
      const value = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<AppSettings>
      return normalize(value, this.defaultKdbConfigRoot)
    } catch {
      return normalize({}, this.defaultKdbConfigRoot)
    }
  }

  async save(value: AppSettings): Promise<AppSettings> {
    const normalized = normalize(value, this.defaultKdbConfigRoot)
    await mkdir(this.userDataPath, { recursive: true })
    await writeFile(this.filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
    return normalized
  }
}

function normalize(value: Partial<AppSettings>, defaultKdbConfigRoot: string): AppSettings {
  return {
    theme: isThemeMode(value.theme) ? value.theme : "system",
    deepseek: {
      apiKey: value.deepseek?.apiKey?.trim() ?? "",
      baseUrl: value.deepseek?.baseUrl?.trim() || DEFAULT_DEEPSEEK_URL,
      model: value.deepseek?.model?.trim() || DEFAULT_MODEL,
    },
    kdbConfigRoot: defaultKdbConfigRoot,
  }
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "dark" || value === "light" || value === "system"
}
