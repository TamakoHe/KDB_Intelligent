import { randomUUID } from "node:crypto"
import { createInterface } from "node:readline"
import { newQuickJSAsyncWASMModule, shouldInterruptAfterDeadline, type QuickJSAsyncContext } from "quickjs-emscripten"
import type { AnalysisHostMethod, AnalysisHostReply, AnalysisWorkerMessage, AnalysisWorkerRun } from "./analysis-contract.js"

const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>()
const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on("line", (line) => {
  try {
    const message = JSON.parse(line) as AnalysisWorkerRun | AnalysisHostReply
    if (message.type === "response") handleResponse(message)
    else if (message.type === "run") void run(message)
  } catch (error) {
    send({ type: "error", error: error instanceof Error ? error.message : String(error) })
  }
})

async function run(message: AnalysisWorkerRun): Promise<void> {
  try {
    const result = await execute(message.request.script)
    send({ type: "result", value: result })
  } catch (error) {
    send({ type: "error", error: error instanceof Error ? error.message : String(error) })
  } finally {
    process.exitCode = 0
  }
}

async function execute(script: string): Promise<unknown> {
  const QuickJS = await newQuickJSAsyncWASMModule()
  const runtime = QuickJS.newRuntime()
  runtime.setMemoryLimit(128 * 1024 * 1024)
  runtime.setMaxStackSize(2 * 1024 * 1024)
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + 5_000))
  const context = runtime.newContext()
  try {
    const hostCall = context.newAsyncifiedFunction("__kdbHostCall", async (methodHandle, argsHandle) => {
      const method = context.getString(methodHandle) as AnalysisHostMethod
      const args = context.dump(argsHandle)
      const response = await requestHost(method, args)
      return context.newString(JSON.stringify(response))
    })
    context.setProp(context.global, "__kdbHostCall", hostCall)
    hostCall.dispose()
    const source = `(async function () {
      const call = (method, args) => {
        const response = JSON.parse(__kdbHostCall(method, args))
        if (!response.ok) throw new Error(response.error || "分析宿主调用失败")
        return response.data
      }
      const kdb = {
        read: {
          batteries: (args) => call("read.batteries", args || {}),
          latestStatus: (args) => call("read.latestStatus", args || {}),
          history: (args) => call("read.history", args || {}),
        },
        export: {
          realtime: (args) => call("export.realtime", args || {}),
        },
      }
      ${script}
      if (typeof main !== "function") throw new Error("分析脚本必须定义 async function main(kdb)")
      return await main(kdb)
    })()`
    const evaluated = await context.evalCodeAsync(source, "kdb-analysis.js")
    const handle = context.unwrapResult(evaluated)
    try {
      const value = await settlePromise(context, runtime, handle)
      try {
        return context.dump(value)
      } finally {
        value.dispose()
      }
    } finally {
      handle.dispose()
    }
  } finally {
    context.dispose()
    runtime.dispose()
  }
}

async function settlePromise(context: QuickJSAsyncContext, runtime: QuickJSAsyncContext["runtime"], handle: ReturnType<QuickJSAsyncContext["newObject"]>): Promise<ReturnType<QuickJSAsyncContext["newObject"]>> {
  for (;;) {
    const state = context.getPromiseState(handle)
    if (state.type === "fulfilled") return state.value
    if (state.type === "rejected") {
      const message = context.dump(state.error)
      state.error.dispose()
      throw new Error(typeof message === "string" ? message : JSON.stringify(message))
    }
    runtime.executePendingJobs()
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

function requestHost(method: AnalysisHostMethod, args: unknown): Promise<unknown> {
  const requestId = randomUUID()
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject })
    send({ type: "request", requestId, method, args })
  })
}

function handleResponse(message: AnalysisHostReply): void {
  const entry = pending.get(message.requestId)
  if (!entry) return
  pending.delete(message.requestId)
  if (message.ok) entry.resolve({ ok: true, data: message.data })
  else entry.resolve({ ok: false, error: message.error ?? "分析宿主调用失败" })
}

function send(message: AnalysisWorkerMessage): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}
