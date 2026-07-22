import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type { KdbConfigFiles } from "../shared.js"

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

  private async copyIfMissing(source: string, destination: string): Promise<void> {
    try {
      await access(destination)
    } catch {
      await copyFile(source, destination)
    }
  }
}
