import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { attachJsonlReader } from './jsonl.js'
import { processGroupOptions, terminateProcess } from './process-control.js'
import type { JsonObject, RpcEvent, RpcResponse } from './types.js'

function resolvePiCli(): string {
  try {
    const mainUrl = import.meta.resolve('@earendil-works/pi-coding-agent')
    return resolve(dirname(fileURLToPath(mainUrl)), 'cli.js')
  } catch {
    return resolve(process.cwd(), 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js')
  }
}

interface PendingRequest {
  resolve: (response: RpcResponse) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

export interface PiRpcOptions {
  cwd: string
  command?: string
  args?: string[]
  env?: NodeJS.ProcessEnv
}

export class PiRpcProcess extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<string, PendingRequest>()
  private requestCounter = 0
  private starting: Promise<void> | null = null
  private stopping = false
  private stderr = ''

  constructor(private readonly options: PiRpcOptions) {
    super()
  }

  get running(): boolean {
    return this.child !== null && this.child.exitCode === null
  }

  async start(): Promise<void> {
    if (this.running) return
    if (this.starting) return this.starting

    this.starting = this.startProcess()
    try {
      await this.starting
    } finally {
      this.starting = null
    }
  }

  private async startProcess(): Promise<void> {
    this.stopping = false
    this.stderr = ''
    const cliPath = resolvePiCli()
    const command = this.options.command ?? process.execPath
    const baseArgs = this.options.command ? [] : [cliPath]
    const args = this.options.args ?? ['--mode', 'rpc', '--continue', '--name', 'Pi Dashboard']
    const finalArgs = [...baseArgs, ...args]
    const childEnv = { ...process.env, ...this.options.env }
    delete childEnv.PI_DASHBOARD_AUTH_TOKEN
    const child = spawn(command, finalArgs, {
      cwd: this.options.cwd,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...processGroupOptions(),
    })
    this.child = child

    attachJsonlReader(child.stdout, (line) => this.handleLine(line))
    child.stderr.on('data', (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString('utf8')}`.slice(-20_000)
    })
    child.once('error', (error) => this.handleExit(error))
    child.once('close', (code, signal) => {
      if (this.child !== child) return
      const detail = this.stderr.trim()
      const message = `Pi RPC exited (${signal ?? `code ${code ?? 'unknown'}`})${detail ? `: ${detail}` : ''}`
      this.handleExit(new Error(message))
    })

    try {
      await this.requestDirect({ type: 'get_state' }, 15_000)
      this.emit('ready')
    } catch (error) {
      terminateProcess(child, 'SIGTERM')
      throw error
    }
  }

  private handleLine(line: string): void {
    let message: RpcResponse | RpcEvent
    try {
      message = JSON.parse(line) as RpcResponse | RpcEvent
    } catch {
      this.emit('protocolError', new Error(`Pi RPC returned invalid JSON: ${line.slice(0, 300)}`))
      return
    }

    if (message.type === 'response') {
      const response = message as RpcResponse
      if (typeof response.id !== 'string') return
      const pending = this.pending.get(response.id)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.pending.delete(response.id)
      if (response.success) pending.resolve(response)
      else pending.reject(new Error(response.error ?? `${response.command} failed`))
      return
    }

    this.emit('event', message)
  }

  private handleExit(error: Error): void {
    if (!this.child) return
    this.child = null
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pending.clear()
    if (!this.stopping) this.emit('exit', error)
  }

  async request(command: JsonObject, timeoutMs = 30_000): Promise<RpcResponse> {
    await this.start()
    return this.requestDirect(command, timeoutMs)
  }

  send(command: JsonObject): void {
    if (!this.running || !this.child) throw new Error('Pi RPC is not running')
    this.child.stdin.write(`${JSON.stringify(command)}\n`)
  }

  private requestDirect(command: JsonObject, timeoutMs: number): Promise<RpcResponse> {
    if (!this.child || !this.running) return Promise.reject(new Error('Pi RPC is not running'))
    const id = `dashboard-${++this.requestCounter}`
    const payload = { ...command, id }

    return new Promise<RpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Pi RPC command timed out: ${String(command.type)}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timeout })
      this.child!.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) return
        clearTimeout(timeout)
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) return
    this.stopping = true
    child.stdin.end()
    terminateProcess(child, 'SIGTERM')

    await Promise.race([
      new Promise<void>((resolve) => child.once('close', () => resolve())),
      new Promise<void>((resolve) => setTimeout(() => {
        terminateProcess(child, 'SIGKILL')
        resolve()
      }, 2_000)),
    ])
    this.child = null
  }
}
