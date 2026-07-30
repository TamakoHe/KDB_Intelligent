import { contextBridge, ipcRenderer } from "electron"
import type { AnalysisProgress, AppSettings, KdbDesktopApi, ScanProgress } from "../shared.js"

const api: KdbDesktopApi = {
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    save: (value: AppSettings) => ipcRenderer.invoke("settings:save", value),
  },
  config: {
    get: () => ipcRenderer.invoke("config:get"),
    save: (value) => ipcRenderer.invoke("config:save", value),
    testLocalDatabase: (localToml) => ipcRenderer.invoke("config:testLocalDatabase", localToml),
  },
  history: {
    list: () => ipcRenderer.invoke("history:list"),
    clear: () => ipcRenderer.invoke("history:clear"),
  },
  chat: { send: (text: string) => ipcRenderer.invoke("chat:send", text) },
  action: {
    confirm: (actionId: string) => ipcRenderer.invoke("action:confirm", actionId),
    runAnalysis: (actionId: string) => ipcRenderer.invoke("action:runAnalysis", actionId),
    cancel: (actionId: string) => ipcRenderer.invoke("action:cancel", actionId),
    runScan: (actionId: string) => ipcRenderer.invoke("action:runScan", actionId),
    pauseScan: (taskId: string) => ipcRenderer.invoke("action:pauseScan", taskId),
    resumeScan: (taskId: string) => ipcRenderer.invoke("action:resumeScan", taskId),
    stopScan: (taskId: string) => ipcRenderer.invoke("action:stopScan", taskId),
    deleteScan: (taskId: string) => ipcRenderer.invoke("action:deleteScan", taskId),
    listActiveScans: () => ipcRenderer.invoke("action:listActiveScans"),
    runSql: (actionId: string) => ipcRenderer.invoke("action:runSql", actionId),
    onProgress: (listener: (progress: AnalysisProgress) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: AnalysisProgress) => listener(progress)
      ipcRenderer.on("analysis:progress", handler)
      return () => ipcRenderer.removeListener("analysis:progress", handler)
    },
    onScanProgress: (listener: (progress: ScanProgress) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: ScanProgress) => listener(progress)
      ipcRenderer.on("scan:progress", handler)
      return () => ipcRenderer.removeListener("scan:progress", handler)
    },
  },
  file: {
    reveal: (filePath: string) => ipcRenderer.invoke("file:reveal", filePath),
    open: (filePath: string) => ipcRenderer.invoke("file:open", filePath),
  },
  clipboard: { writeText: (value: string) => ipcRenderer.invoke("clipboard:write", value) },
}

contextBridge.exposeInMainWorld("kdb", api)
