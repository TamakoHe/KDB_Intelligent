import fs from "fs/promises"
import path from "path"
import type { RuntimeConfig } from "../config/index.js"

export function getDefaultOutputDir(cfg: RuntimeConfig): string {
  return cfg.app.default_output_dor
}

export function parseFilenameFromContentDisposition(value: string | null): string | undefined {
  if (!value) {
    return undefined
  }

  const filenameStar = value.match(/filename\*\s*=\s*([^;]+)/i)
  if (filenameStar) {
    const raw = filenameStar[1]?.trim()
    if (raw) {
      const cleaned = raw.replace(/^UTF-8''/i, "").trim()
      try {
        return path.basename(decodeURIComponent(cleaned))
      } catch {
        return path.basename(cleaned)
      }
    }
  }

  const filename = value.match(/filename\s*=\s*("([^"]+)"|([^;]+))/i)
  if (filename) {
    const quoted = filename[2]
    const plain = filename[3]
    const name = (quoted ?? plain ?? "").trim()
    if (name) {
      return path.basename(name)
    }
  }

  return undefined
}

export function resolveOutputPath(args: {
  outputPath?: string
  defaultDir: string
  defaultName: string
}): string {
  const out = args.outputPath?.trim()
  if (out) {
    return out
  }
  return path.join(args.defaultDir, args.defaultName)
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

export async function saveArrayBuffer(args: { outputPath: string; data: ArrayBuffer }): Promise<void> {
  const dir = path.dirname(args.outputPath)
  await ensureDir(dir)
  const tmpPath = `${args.outputPath}.tmp_${Date.now()}`
  await fs.writeFile(tmpPath, new Uint8Array(args.data))
  await fs.rename(tmpPath, args.outputPath)
}

