import { FormEvent, useEffect, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { AnalysisProgress, AppSettings, ChatHistoryItem, KdbConfigFiles, LocalDatabaseConnectionTest, ResultCard, ScanProgress, ScanTaskSnapshot, ThemeMode } from "../shared"

type Message = ChatHistoryItem

export function App() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [runningAnalysisId, setRunningAnalysisId] = useState<string | null>(null)
  const [analysisProgress, setAnalysisProgress] = useState<Record<string, AnalysisProgress[]>>({})
  const [scanProgress, setScanProgress] = useState<Record<string, ScanProgress[]>>({})
  const [activeScans, setActiveScans] = useState<ScanTaskSnapshot[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [config, setConfig] = useState<KdbConfigFiles | null>(null)
  const [showConfig, setShowConfig] = useState(false)
  const [connectionTest, setConnectionTest] = useState<LocalDatabaseConnectionTest | null>(null)
  const [testingConnection, setTestingConnection] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    void Promise.all([window.kdb.history.list(), window.kdb.settings.get(), window.kdb.action.listActiveScans()]).then(([history, loadedSettings, scans]) => {
      setMessages(history)
      setSettings(loadedSettings)
      setActiveScans(scans)
      if (!loadedSettings.deepseek.apiKey) setShowSettings(true)
    })
  }, [])

  useEffect(() => window.kdb.action.onProgress((progress) => {
    setAnalysisProgress((current) => ({ ...current, [progress.actionId]: [...(current[progress.actionId] ?? []), progress].slice(-200) }))
  }), [])

  useEffect(() => window.kdb.action.onScanProgress((progress) => {
    setScanProgress((current) => ({ ...current, [progress.taskId]: [...(current[progress.taskId] ?? []), progress].slice(-300) }))
    void window.kdb.action.listActiveScans().then(setActiveScans)
  }), [])

  useEffect(() => {
    if (!settings) return
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const applyTheme = () => {
      const resolved = settings.theme === "system" ? (media.matches ? "dark" : "light") : settings.theme
      document.documentElement.dataset.theme = resolved
    }
    applyTheme()
    if (settings.theme !== "system") return
    media.addEventListener("change", applyTheme)
    return () => media.removeEventListener("change", applyTheme)
  }, [settings])

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

  async function runAnalysis(card: ResultCard) {
    if (!card.actionId) return
    setRunningAnalysisId(card.actionId)
    setBusy(true)
    try {
      const result = await window.kdb.action.runAnalysis(card.actionId)
      setMessages((current) => [...current, { ...localMessage("assistant", result.summary), cards: [result] }])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setRunningAnalysisId(null)
      setBusy(false)
    }
  }

  async function stopAnalysis(card: ResultCard): Promise<void> {
    if (!card.actionId) return
    await window.kdb.action.cancel(card.actionId)
  }

  async function runScan(card: ResultCard): Promise<void> {
    if (!card.actionId) return
    setBusy(true)
    try {
      const result = await window.kdb.action.runScan(card.actionId)
      setMessages((current) => [
        ...current.map((message) => ({ ...message, cards: message.cards?.map((item) => item.id === card.id ? { ...item, actionId: undefined, actionLabel: undefined, actionExpired: true, summary: `${item.summary}\n\n扫描任务已启动，请查看下方进度。` } : item) })),
        { ...localMessage("assistant", result.summary), cards: [result] },
      ])
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false); setActiveScans(await window.kdb.action.listActiveScans()) }
  }

  async function runSql(card: ResultCard): Promise<void> {
    if (!card.actionId) return
    setBusy(true)
    try { const result = await window.kdb.action.runSql(card.actionId); setMessages((current) => [...current, { ...localMessage("assistant", result.summary), cards: [result] }]) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  async function pauseScan(taskId: string): Promise<void> { await window.kdb.action.pauseScan(taskId); setActiveScans(await window.kdb.action.listActiveScans()) }
  async function resumeScan(taskId: string): Promise<void> {
    setBusy(true)
    try { const result = await window.kdb.action.resumeScan(taskId); setMessages((current) => [...current, { ...localMessage("assistant", result.summary), cards: [result] }]) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false); setActiveScans(await window.kdb.action.listActiveScans()) }
  }
  async function stopScanTask(taskId: string): Promise<void> { await window.kdb.action.stopScan(taskId); setActiveScans(await window.kdb.action.listActiveScans()) }
  async function deleteScanTask(taskId: string): Promise<void> {
    await window.kdb.action.deleteScan(taskId)
    setActiveScans((current) => current.filter((scan) => scan.taskId !== taskId))
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
      {activeScans.length > 0 && <div className="active-scans"><strong>未完成扫描</strong>{activeScans.map((scan) => <div className="active-scan-row" key={scan.taskId}><button onClick={() => { void resumeScan(scan.taskId) }}>{scan.status === "paused" ? "继续" : "恢复"}：{scan.purpose.slice(0, 18)}</button><button className="mini danger" title="删除任务条目" onClick={() => { void deleteScanTask(scan.taskId) }}>删除</button></div>)}</div>}
      <p className="safety">控制、写入与 OTA 必须在确认卡片中由你点击确认。</p>
    </aside>
    <section className="chat-panel">
      <header><div><p className="eyebrow">DESKTOP AGENT</p><h2>问问电池当前或历史情况</h2></div><span className="badge">DeepSeek</span></header>
      <div className="messages">
        {messages.length === 0 && <div className="empty"><h3>可以这样问</h3><p>“查询 623B1C10 的状态”</p><p>“导出它在 2026-05-15 13:45 到 15:45 的历史数据，API 为空就查本地”</p><p>“预览锁电模式，不要立即执行”</p></div>}
        {messages.map((message) => <article className={`message ${message.role}`} key={message.id}>
          {message.role === "assistant" ? <Markdown content={message.content} /> : <p>{message.content}</p>}
          {message.cards?.map((card) => <Card key={card.id} card={card} busy={busy} runningAnalysisId={runningAnalysisId} progressLog={card.actionId ? analysisProgress[card.actionId] : undefined} scanProgressLog={typeof card.data?.taskId === "string" ? scanProgress[card.data.taskId] : undefined} onConfirm={confirm} onRunAnalysis={runAnalysis} onStopAnalysis={stopAnalysis} onRunScan={runScan} onRunSql={runSql} onPauseScan={pauseScan} onResumeScan={resumeScan} onStopScan={stopScanTask} />)}
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

function Card({ card, busy, runningAnalysisId, progressLog, scanProgressLog, onConfirm, onRunAnalysis, onStopAnalysis, onRunScan, onRunSql, onPauseScan, onResumeScan, onStopScan }: { card: ResultCard; busy: boolean; runningAnalysisId: string | null; progressLog?: AnalysisProgress[]; scanProgressLog?: ScanProgress[]; onConfirm(card: ResultCard): Promise<void>; onRunAnalysis(card: ResultCard): Promise<void>; onStopAnalysis(card: ResultCard): Promise<void>; onRunScan(card: ResultCard): Promise<void>; onRunSql(card: ResultCard): Promise<void>; onPauseScan(taskId: string): Promise<void>; onResumeScan(taskId: string): Promise<void>; onStopScan(taskId: string): Promise<void> }) {
  const data = card.data ?? {}
  const outputPaths = collectOutputPaths(data)
  const outputDir = typeof data.outputDir === "string" ? data.outputDir : undefined
  return <section className={`card ${card.kind}`}>
    <strong>{card.title}</strong><Markdown content={card.summary} />
    {card.kind === "analysis-preview" && <AnalysisPreview data={data} progressLog={progressLog} />}
    {(card.kind === "scan-preview" || card.kind === "scan") && <ScanDetails data={data} progressLog={scanProgressLog} />}
    {card.kind === "sql-preview" && <SqlDetails data={data} />}
    {outputPaths.length > 0 && <div className="file-actions">{outputPaths.map((outputPath) => <button key={outputPath} onClick={() => { void window.kdb.file.open(outputPath) }}>打开 {fileName(outputPath)}</button>)}</div>}
    {outputDir && <button onClick={() => { void window.kdb.file.reveal(outputDir) }}>打开导出文件夹</button>}
    {card.actionId && !["analysis-preview", "scan-preview", "sql-preview"].includes(card.kind) && <div className="card-actions"><button className="danger" disabled={busy} onClick={() => { void onConfirm(card) }}>{card.actionLabel ?? "确认执行"}</button><button disabled={busy} onClick={() => { window.kdb.action.cancel(card.actionId!); }}>取消</button></div>}
    {card.kind === "analysis-preview" && card.actionId && <div className="card-actions">{runningAnalysisId === card.actionId ? <button className="danger" onClick={() => { void onStopAnalysis(card) }}>停止分析</button> : <button className="danger" disabled={busy} onClick={() => { void onRunAnalysis(card) }}>{card.actionLabel ?? "运行分析"}</button>}<button disabled={busy && runningAnalysisId !== card.actionId} onClick={() => { void onStopAnalysis(card) }}>{runningAnalysisId === card.actionId ? "停止" : "取消"}</button></div>}
    {card.kind === "scan-preview" && card.actionId && <div className="card-actions"><button className="danger" disabled={busy} onClick={() => { void onRunScan(card) }}>开始扫描</button></div>}
    {card.kind === "sql-preview" && card.actionId && <div className="card-actions"><button className="danger" disabled={busy} onClick={() => { void onRunSql(card) }}>执行专家查询</button></div>}
    {card.kind === "scan" && typeof data.taskId === "string" && <div className="card-actions"><button onClick={() => { void onPauseScan(data.taskId as string) }}>暂停</button><button onClick={() => { void onResumeScan(data.taskId as string) }}>继续</button><button className="danger" onClick={() => { void onStopScan(data.taskId as string) }}>停止</button></div>}
    {Object.keys(data).length > 0 && <details><summary>查看原始结果</summary><pre>{JSON.stringify(data, null, 2)}</pre></details>}
  </section>
}

function ScanDetails({ data, progressLog }: { data: Record<string, unknown>; progressLog?: ScanProgress[] }) {
  const latest = progressLog?.at(-1)
  return <div className="analysis-preview">{typeof data.source === "string" && <p className="muted">数据源：{data.source}；批次：{String(data.batchSize ?? 100)}；并发：{String(data.concurrency ?? 4)}</p>}{latest && <div className="analysis-progress"><strong>{latest.message}</strong><span>已扫描：{latest.scanned ?? 0}{latest.total !== undefined ? `/${latest.total}` : ""} · 匹配：{latest.matched ?? 0} · 记录：{latest.rows ?? 0} · 失败：{latest.failed ?? 0}</span>{progressLog && <details><summary>查看扫描日志（{progressLog.length} 条）</summary><pre>{progressLog.map((item) => item.message).join("\n")}</pre></details>}</div>}</div>
}

function SqlDetails({ data }: { data: Record<string, unknown> }) { return <div className="analysis-preview"><p className="muted">数据源：本地历史库</p>{typeof data.warning === "string" && <p className="muted">{data.warning}</p>}{typeof data.sql === "string" && <pre><code>{data.sql}</code></pre>}</div> }

function AnalysisPreview({ data, progressLog }: { data: Record<string, unknown>; progressLog?: AnalysisProgress[] }) {
  const script = typeof data.script === "string" ? data.script : ""
  const permissions = Array.isArray(data.permissions) ? data.permissions.filter((value): value is string => typeof value === "string") : []
  const progress = progressLog?.at(-1)
  return <div className="analysis-preview">
    {permissions.length > 0 && <p className="muted">权限：{permissions.join("、")}</p>}
    {typeof data.source === "string" && <p className="muted">数据源：{data.source}（API 优先，空结果才回退本地）</p>}
    {script && <details open><summary>查看分析脚本</summary><pre><code>{script}</code></pre></details>}
    {progress && <div className="analysis-progress"><strong>{progress.message}</strong>{progress.currentBatteryId && <span>当前电池：{progress.currentBatteryId}</span>}{progress.scanned !== undefined && <span>已扫描：{progress.scanned}{progress.total !== undefined ? `/${progress.total}` : ""}</span>}{progress.matched !== undefined && <span>匹配记录：{progress.matched}</span>}{progress.exportedRows !== undefined && <span>已导出：{progress.exportedRows} 条</span>}{progressLog && progressLog.length > 0 && <details open><summary>查看扫描日志（{progressLog.length} 条）</summary><pre>{progressLog.map((item) => `${item.message}${item.currentBatteryId ? ` · ${item.currentBatteryId}` : ""}`).join("\n")}</pre></details>}</div>}
  </div>
}

function Markdown({ content }: { content: string }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div>
}

function collectOutputPaths(value: unknown): string[] {
  const paths = new Set<string>()
  function visit(item: unknown): void {
    if (!item || typeof item !== "object") return
    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }
    const record = item as Record<string, unknown>
    if (typeof record.outputPath === "string") paths.add(record.outputPath)
    Object.values(record).forEach(visit)
  }
  visit(value)
  return [...paths]
}

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || "文件"
}

function Settings({ value, onChange, onSave, onEditConfig, onClose }: { value: AppSettings; onChange(value: AppSettings): void; onSave(event: FormEvent): Promise<void>; onEditConfig(): Promise<void>; onClose(): void }) {
  return <div className="modal-backdrop"><form className="settings" onSubmit={(event) => { void onSave(event) }}>
    <h2>连接设置</h2>
    <label>DeepSeek API Key<input value={value.deepseek.apiKey} type="password" onChange={(event) => onChange({ ...value, deepseek: { ...value.deepseek, apiKey: event.target.value } })} /></label>
    <label>DeepSeek Base URL<input value={value.deepseek.baseUrl} onChange={(event) => onChange({ ...value, deepseek: { ...value.deepseek, baseUrl: event.target.value } })} /></label>
    <label>模型<input value={value.deepseek.model} onChange={(event) => onChange({ ...value, deepseek: { ...value.deepseek, model: event.target.value } })} /></label>
    <label>界面颜色<select value={value.theme} onChange={(event) => onChange({ ...value, theme: event.target.value as ThemeMode })}><option value="dark">深色</option><option value="light">浅色</option><option value="system">随系统</option></select></label>
    <label>单次导出最大条目<input type="text" inputMode="numeric" pattern="[0-9]*" value={String(value.exportMaxRows)} onChange={(event) => { const raw = event.target.value; if (/^\d*$/.test(raw)) onChange({ ...value, exportMaxRows: raw ? Number(raw) : 0 }) }} /></label>
    <p className="muted">默认 20,000 条，范围为 1~100,000；该限制同时作用于网页 API 与本地历史库导出。</p>
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
