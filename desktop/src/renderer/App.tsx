import { FormEvent, useEffect, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { AppSettings, ChatHistoryItem, KdbConfigFiles, LocalDatabaseConnectionTest, ResultCard } from "../shared"

type Message = ChatHistoryItem

export function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [config, setConfig] = useState<KdbConfigFiles | null>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [connectionTest, setConnectionTest] = useState<LocalDatabaseConnectionTest | null>(null)
  const [testingConnection, setTestingConnection] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    void Promise.all([window.kdb.history.list(), window.kdb.settings.get()]).then(([history, loadedSettings]) => {
      setMessages(history)
      setSettings(loadedSettings)
      if (!loadedSettings.deepseek.apiKey) setShowSettings(true)
    })
  }, [])

  async function send(event: FormEvent) {
    event.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    setError("")
    setInput("")
    setMessages((current) => [...current, localMessage("user", text)])
    setBusy(true)
    try {
      const reply = await window.kdb.chat.send(text)
      setMessages((current) => [...current, { ...localMessage("assistant", reply.text), cards: reply.cards }])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function confirm(card: ResultCard) {
    if (!card.actionId) return
    setBusy(true)
    try {
      const result = await window.kdb.action.confirm(card.actionId)
      setMessages((current) => [...current, { ...localMessage("assistant", result.summary), cards: [result] }])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault()
    if (!settings) return
    const saved = await window.kdb.settings.save(settings)
    setSettings(saved)
    setShowSettings(false)
  }

  async function openConfig() {
    setError("")
    try {
      setConfig(await window.kdb.config.get())
      setConnectionTest(null)
      setShowSettings(false)
      setShowConfig(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  async function testLocalDatabase() {
    if (!config) return
    setTestingConnection(true)
    try {
      setConnectionTest(await window.kdb.config.testLocalDatabase(config.localToml))
    } catch (reason) {
      setConnectionTest({ configured: false, ok: false, message: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setTestingConnection(false)
    }
  }

  async function saveConfig(event: FormEvent) {
    event.preventDefault()
    if (!config) return
    try {
      setConfig(await window.kdb.config.save(config))
      setShowConfig(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return <main className="app-shell">
    <aside className="sidebar">
      <div><p className="eyebrow">KDB INTELLIGENT</p><h1>KDB Copilot</h1><p className="muted">电池数据与操作助手</p></div>
      <div className="sidebar-actions">
        <button onClick={() => setShowSettings(true)}>设置</button>
        <button onClick={() => { void window.kdb.history.clear(); setMessages([]) }}>清空会话</button>
      </div>
      <p className="safety">控制、写入与 OTA 必须在确认卡片中由你点击确认。</p>
    </aside>
    <section className="chat-panel">
      <header><div><p className="eyebrow">DESKTOP AGENT</p><h2>问问电池当前或历史情况</h2></div><span className="badge">DeepSeek</span></header>
      <div className="messages">
        {messages.length === 0 && <div className="empty"><h3>可以这样问</h3><p>“查询 623B1C10 的状态”</p><p>“导出它在 2026-05-15 13:45 到 15:45 的历史数据，API 为空就查本地”</p><p>“预览锁电模式，不要立即执行”</p></div>}
        {messages.map((message) => <article className={`message ${message.role}`} key={message.id}>
          {message.role === "assistant" ? <Markdown content={message.content} /> : <p>{message.content}</p>}
          {message.cards?.map((card) => <Card key={card.id} card={card} busy={busy} onConfirm={confirm} />)}
        </article>)}
        {busy && <div className="thinking">正在查询和整理结果…</div>}
      </div>
      {error && <p className="error">{error}</p>}
      <form className="composer" onSubmit={send}>
        <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="输入自然语言问题，例如：查询 623B1C10 的本地历史状态" rows={3} />
        <button type="submit" disabled={busy || !input.trim()}>发送</button>
      </form>
    </section>
    {showSettings && settings && <Settings value={settings} onChange={setSettings} onSave={saveSettings} onEditConfig={openConfig} onClose={() => setShowSettings(false)} />}
    {showConfig && config && <ConfigEditor value={config} onChange={setConfig} onSave={saveConfig} onTest={testLocalDatabase} testing={testingConnection} connectionTest={connectionTest} onClose={() => setShowConfig(false)} />}
  </main>
}

function Card({ card, busy, onConfirm }: { card: ResultCard; busy: boolean; onConfirm(card: ResultCard): Promise<void> }) {
  const data = card.data ?? {}
  const outputPath = typeof data.outputPath === "string" ? data.outputPath : undefined
  return <section className={`card ${card.kind}`}>
    <strong>{card.title}</strong><Markdown content={card.summary} />
    {outputPath && <button onClick={() => { void window.kdb.file.reveal(outputPath) }}>显示导出文件</button>}
    {card.actionId && <div className="card-actions"><button className="danger" disabled={busy} onClick={() => { void onConfirm(card) }}>{card.actionLabel ?? "确认执行"}</button><button disabled={busy} onClick={() => { window.kdb.action.cancel(card.actionId!); }}>取消</button></div>}
    {Object.keys(data).length > 0 && <details><summary>查看原始结果</summary><pre>{JSON.stringify(data, null, 2)}</pre></details>}
  </section>
}

function Markdown({ content }: { content: string }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div>
}

function Settings({ value, onChange, onSave, onEditConfig, onClose }: { value: AppSettings; onChange(value: AppSettings): void; onSave(event: FormEvent): Promise<void>; onEditConfig(): Promise<void>; onClose(): void }) {
  return <div className="modal-backdrop"><form className="settings" onSubmit={(event) => { void onSave(event) }}>
    <h2>连接设置</h2>
    <label>DeepSeek API Key<input value={value.deepseek.apiKey} type="password" onChange={(event) => onChange({ ...value, deepseek: { ...value.deepseek, apiKey: event.target.value } })} /></label>
    <label>DeepSeek Base URL<input value={value.deepseek.baseUrl} onChange={(event) => onChange({ ...value, deepseek: { ...value.deepseek, baseUrl: event.target.value } })} /></label>
    <label>模型<input value={value.deepseek.model} onChange={(event) => onChange({ ...value, deepseek: { ...value.deepseek, model: event.target.value } })} /></label>
    <p className="muted">KDB 配置由应用内部管理，不读取外部项目目录。</p>
    <div className="modal-actions"><button type="button" onClick={() => { void onEditConfig() }}>编辑应用内 KDB 配置</button><button type="button" onClick={onClose}>取消</button><button type="submit">保存</button></div>
  </form></div>
}

function ConfigEditor({ value, onChange, onSave, onTest, testing, connectionTest, onClose }: { value: KdbConfigFiles; onChange(value: KdbConfigFiles): void; onSave(event: FormEvent): Promise<void>; onTest(): Promise<void>; testing: boolean; connectionTest: LocalDatabaseConnectionTest | null; onClose(): void }) {
  const [copiedWorkaround, setCopiedWorkaround] = useState(false)
  async function copyWorkaround(): Promise<void> {
    if (!connectionTest?.workaround) return
    await window.kdb.clipboard.writeText(connectionTest.workaround.command)
    setCopiedWorkaround(true)
  }

  return <div className="modal-backdrop"><form className="settings config-editor" onSubmit={(event) => { void onSave(event) }}>
    <h2>应用内 KDB 配置</h2>
    <p className="muted">保存位置：{value.configRoot}/config。保存后下一次查询会使用新配置。</p>
    <label>kdb.toml<textarea value={value.publicToml} onChange={(event) => onChange({ ...value, publicToml: event.target.value })} rows={12} /></label>
    <label>kdb.local.toml<textarea value={value.localToml} onChange={(event) => onChange({ ...value, localToml: event.target.value })} rows={14} /></label>
    <button type="button" disabled={testing} onClick={() => { void onTest() }}>{testing ? "正在测试本地库…" : "测试本地历史库连接"}</button>
    {connectionTest && <p className={`connection-result ${connectionTest.ok ? "ok" : "failed"}`}>{connectionTest.host && `${connectionTest.host}:${connectionTest.port} · `}{connectionTest.message}{connectionTest.errorCode && ` (${connectionTest.errorCode})`}</p>}
    {connectionTest?.workaround && <section className="network-workaround">
      <strong>{connectionTest.workaround.title}</strong>
      <p>{connectionTest.workaround.description}</p>
      <code>{connectionTest.workaround.command}</code>
      <button type="button" onClick={() => { void copyWorkaround() }}>{copiedWorkaround ? "已复制" : "复制命令"}</button>
    </section>}
    <div className="modal-actions"><button type="button" onClick={onClose}>取消</button><button type="submit">保存配置</button></div>
  </form></div>
}

function localMessage(role: "user" | "assistant", content: string): ChatHistoryItem {
  return { id: Date.now() + Math.floor(Math.random() * 1000), role, content, createdAt: new Date().toISOString() }
}
