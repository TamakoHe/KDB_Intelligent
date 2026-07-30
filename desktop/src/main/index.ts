import { app, BrowserWindow, clipboard, ipcMain, shell } from "electron"
import { join, resolve } from "node:path"
import { KdbAgent } from "./agent.js"
import { ConfigStore } from "./config-store.js"
import { HistoryStore } from "./history.js"
import { closeKdbCore } from "./kdb-core.js"
import { SettingsStore } from "./settings.js"
import { cancelAction, confirmAction, pauseScan, resumeScan, runAnalysis, runScan, runSql, stopScan } from "./tools.js"
import { onAnalysisProgress } from "./analysis-host.js"
import { closeScanStore, configureScanStore, deleteScanTask, listActiveScanTasks, onScanProgress } from "./scan-host.js"
import type { AppSettings } from "../shared.js"

let mainWindow: BrowserWindow | undefined
let settings: SettingsStore
let history: HistoryStore
let agent: KdbAgent
let configStore: ConfigStore

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

if (process.argv.includes("--analysis-worker")) {
  void import("./analysis-worker.js")
} else app.whenReady().then(async () => {
  const userData = app.getPath("userData")
  const templateRoot = app.isPackaged ? join(process.resourcesPath, "kdb-core") : resolve(app.getAppPath(), "..")
  configStore = new ConfigStore(userData, templateRoot)
  await configStore.ensure()
  settings = new SettingsStore(userData, configStore.configRoot)
  history = new HistoryStore(userData)
  configureScanStore(userData)
  agent = new KdbAgent(history)
  createWindow()

  ipcMain.handle("settings:get", () => settings.get())
  ipcMain.handle("settings:save", (_event, value: AppSettings) => settings.save(value))
  ipcMain.handle("config:get", () => configStore.read())
  ipcMain.handle("config:save", async (_event, value) => {
    const saved = await configStore.save(value)
    await closeKdbCore()
    return saved
  })
  ipcMain.handle("config:testLocalDatabase", (_event, localToml: string) => configStore.testLocalDatabase(localToml))
  ipcMain.handle("history:list", () => history.list())
  ipcMain.handle("history:clear", () => history.clear())
  ipcMain.handle("chat:send", async (_event, text: string) => agent.reply(text, await settings.get()))
  ipcMain.handle("action:confirm", async (_event, actionId: string) => {
    const result = await confirmAction(actionId, await settings.get())
    history.append("assistant", result.summary, [result])
    return result
  })
  ipcMain.handle("action:runAnalysis", async (_event, actionId: string) => {
    const result = await runAnalysis(actionId, await settings.get())
    history.append("assistant", result.summary, [result])
    return result
  })
  ipcMain.handle("action:runScan", async (_event, actionId: string) => {
    const result = await runScan(actionId, await settings.get())
    history.append("assistant", result.summary, [result])
    return result
  })
  ipcMain.handle("action:runSql", async (_event, actionId: string) => {
    const result = await runSql(actionId, await settings.get())
    history.append("assistant", result.summary, [result])
    return result
  })
  ipcMain.handle("action:pauseScan", (_event, taskId: string) => pauseScan(taskId))
  ipcMain.handle("action:resumeScan", async (_event, taskId: string) => {
    const result = await resumeScan(taskId, await settings.get())
    history.append("assistant", result.summary, [result])
    return result
  })
  ipcMain.handle("action:stopScan", (_event, taskId: string) => stopScan(taskId))
  ipcMain.handle("action:deleteScan", (_event, taskId: string) => deleteScanTask(taskId))
  ipcMain.handle("action:listActiveScans", () => listActiveScanTasks().map((task) => ({ taskId: task.taskId, status: task.status, purpose: task.request.purpose, ...task.stats, cursor: task.cursor.itemIndex })))
  ipcMain.handle("action:cancel", (_event, actionId: string) => cancelAction(actionId))
  onAnalysisProgress((progress) => mainWindow?.webContents.send("analysis:progress", progress))
  onScanProgress((progress) => mainWindow?.webContents.send("scan:progress", progress))
  ipcMain.handle("file:reveal", (_event, filePath: string) => shell.showItemInFolder(filePath))
  ipcMain.handle("file:open", (_event, filePath: string) => shell.openPath(filePath))
  ipcMain.handle("clipboard:write", (_event, value: string) => clipboard.writeText(value))

  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on("window-all-closed", () => { if (!process.argv.includes("--analysis-worker") && process.platform !== "darwin") app.quit() })
app.on("before-quit", async () => {
  history?.close()
  closeScanStore()
  await closeKdbCore()
})
