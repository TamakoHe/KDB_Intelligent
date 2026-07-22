import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import react from "@vitejs/plugin-react"
import path from "node:path"

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, "src/main/index.ts"),
          "analysis-worker": path.resolve(__dirname, "src/main/analysis-worker.ts"),
        },
      },
    },
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] },
})
