import { contextBridge, ipcRenderer } from "electron"
import type { AppSettings, KdbDesktopApi } from "../shared.js"

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
    cancel: (actionId: string) => ipcRenderer.invoke("action:cancel", actionId),
  },
  file: {
    reveal: (filePath: string) => ipcRenderer.invoke("file:reveal", filePath),
    open: (filePath: string) => ipcRenderer.invoke("file:open", filePath),
  },
  clipboard: { writeText: (value: string) => ipcRenderer.invoke("clipboard:write", value) },
}

contextBridge.exposeInMainWorld("kdb", api)
