import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import type { ChatHistoryItem } from "../shared.js"

export class HistoryStore {
  private readonly db: DatabaseSync

  constructor(userDataPath: string) {
    this.db = new DatabaseSync(path.join(userDataPath, "copilot.sqlite"))
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `)
  }

  list(limit = 60): ChatHistoryItem[] {
    return this.db.prepare("SELECT id, role, content, created_at AS createdAt FROM messages ORDER BY id DESC LIMIT ?")
      .all(limit)
      .reverse() as ChatHistoryItem[]
  }

  append(role: "user" | "assistant", content: string): void {
    this.db.prepare("INSERT INTO messages (role, content, created_at) VALUES (?, ?, ?)")
      .run(role, content, new Date().toISOString())
  }

  clear(): void {
    this.db.exec("DELETE FROM messages")
  }

  close(): void {
    this.db.close()
  }
}
