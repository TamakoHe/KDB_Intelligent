import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import type { ChatHistoryItem, ResultCard } from "../shared.js"

export class HistoryStore {
  private readonly db: DatabaseSync

  constructor(userDataPath: string) {
    this.db = new DatabaseSync(path.join(userDataPath, "copilot.sqlite"))
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        cards_json TEXT,
        created_at TEXT NOT NULL
      )
    `)
    this.ensureCardsColumn()
  }

  list(limit = 60): ChatHistoryItem[] {
    const rows = this.db.prepare("SELECT id, role, content, cards_json AS cardsJson, created_at AS createdAt FROM messages ORDER BY id DESC LIMIT ?")
      .all(limit)
      .reverse() as unknown as Array<ChatHistoryItem & { cardsJson?: string | null }>
    return rows.map(({ cardsJson, ...item }) => ({ ...item, ...(cardsJson ? { cards: parseCards(cardsJson) } : {}) }))
  }

  append(role: "user" | "assistant", content: string, cards: ResultCard[] = []): void {
    const cardsJson = cards.length ? JSON.stringify(cards.map(toHistoricalCard)) : null
    this.db.prepare("INSERT INTO messages (role, content, cards_json, created_at) VALUES (?, ?, ?, ?)")
      .run(role, content, cardsJson, new Date().toISOString())
  }

  clear(): void {
    this.db.exec("DELETE FROM messages")
  }

  close(): void {
    this.db.close()
  }

  private ensureCardsColumn(): void {
    const columns = this.db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>
    if (!columns.some((column) => column.name === "cards_json")) this.db.exec("ALTER TABLE messages ADD COLUMN cards_json TEXT")
  }
}

function toHistoricalCard(card: ResultCard): ResultCard {
  const { actionId: _actionId, actionLabel: _actionLabel, ...historical } = card
  return historical
}

function parseCards(value: string): ResultCard[] {
  try {
    const cards = JSON.parse(value)
    return Array.isArray(cards) ? cards.filter(isResultCard).map(toHistoricalCard) : []
  } catch {
    return []
  }
}

function isResultCard(value: unknown): value is ResultCard {
  return Boolean(value && typeof value === "object" && typeof (value as ResultCard).id === "string" && typeof (value as ResultCard).kind === "string" && typeof (value as ResultCard).title === "string" && typeof (value as ResultCard).summary === "string")
}
