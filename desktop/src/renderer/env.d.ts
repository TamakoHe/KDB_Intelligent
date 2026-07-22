import type { KdbDesktopApi } from "../shared.js"

declare global {
  interface Window { kdb: KdbDesktopApi }
}

export {}
