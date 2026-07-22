import { app, BrowserWindow, ipcMain, shell } from "electron"
import { join, resolve } from "node:path"
import { KdbAgent } from "./agent.js"
import { HistoryStore } from "./history.js"
import { closeKdbCore } from "./kdb-core.js"
import { SettingsStore } from "./settings.js"
import { cancelAction, confirmAction } from "./tools.js"
import type { AppSettings } from "../shared.js"

let mainWindow: BrowserWindow | undefined
let settings: SettingsStore
let history: HistoryStore
let agent: KdbAgent

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 960,
    minHeight: 680,
    webPreferences: { preload: join(__dirname, "../preload/index.mjs"), contextIsolation: true, nodeIntegration: false, sandbox: false },
  })
  if (process.env.ELECTRON_RENDERER_URL) mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else mainWindow.loadFile(join(__dirname, "../renderer/index.html"))
}

app.whenReady().then(() => {
  const userData = app.getPath("userData")
  const bundledConfigRoot = app.isPackaged ? join(process.resourcesPath, "kdb-core") : resolve(app.getAppPath(), "..")
  settings = new SettingsStore(userData, bundledConfigRoot)
  history = new HistoryStore(userData)
  agent = new KdbAgent(history)
  createWindow()

  ipcMain.handle("settings:get", () => settings.get())
  ipcMain.handle("settings:save", (_event, value: AppSettings) => settings.save(value))
  ipcMain.handle("history:list", () => history.list())
  ipcMain.handle("history:clear", () => history.clear())
  ipcMain.handle("chat:send", async (_event, text: string) => agent.reply(text, await settings.get()))
  ipcMain.handle("action:confirm", async (_event, actionId: string) => confirmAction(actionId, await settings.get()))
  ipcMain.handle("action:cancel", (_event, actionId: string) => cancelAction(actionId))
  ipcMain.handle("file:reveal", (_event, filePath: string) => shell.showItemInFolder(filePath))

  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit() })
app.on("before-quit", async () => {
  history?.close()
  await closeKdbCore()
})
