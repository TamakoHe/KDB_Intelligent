import path from "node:path"
import { pathToFileURL } from "node:url"
import { app } from "electron"
import type { AppSettings } from "../shared.js"

type KdbCore = Record<string, (...args: any[]) => any>

let corePromise: Promise<KdbCore> | undefined
let clientsPromise: Promise<any> | undefined
let activeConfigRoot: string | undefined

function coreEntry(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "kdb-core", "index.js")
  return path.resolve(app.getAppPath(), "..", "dist", "index.js")
}

export async function getCore(): Promise<KdbCore> {
  corePromise ??= import(pathToFileURL(coreEntry()).href) as Promise<KdbCore>
  return corePromise
}

export async function getKdbClients(settings: AppSettings): Promise<any> {
  if (!clientsPromise || activeConfigRoot !== settings.kdbConfigRoot) {
    const core = await getCore()
    if (clientsPromise) {
      const previous = await clientsPromise
      await core.closeLocalHistoryRepositories?.()
      void previous
    }
    activeConfigRoot = settings.kdbConfigRoot
    clientsPromise = core.createKdbClients(settings.kdbConfigRoot)
  }
  return clientsPromise
}

export async function closeKdbCore(): Promise<void> {
  const core = await getCore()
  await core.closeLocalHistoryRepositories?.()
  clientsPromise = undefined
  activeConfigRoot = undefined
}
