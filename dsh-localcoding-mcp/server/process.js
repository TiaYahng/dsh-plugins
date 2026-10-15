/**
 * Lifecycle owner for the LocalCodingMCP server process.
 *
 * The plugin, not the user, decides when the server runs: it starts on demand,
 * restarts after a crash, and stops with the host. Two launch modes exist —
 * `managed` (we spawn the .NET exe) and `external` (the user already runs one,
 * e.g. the multi-account tunnel fleet from mcp-accounts) and we only talk to it.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'

const HEALTH_RETRIES = 40
const HEALTH_INTERVAL_MS = 250
const STOP_GRACE_MS = 4_000

/** Probe /health until the server answers, or give up with a usable message. */
async function waitForHealth (url) {
  let lastError = 'timed out'
  for (let attempt = 0; attempt < HEALTH_RETRIES; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
      if (response.ok) return await response.json().catch(() => ({}))
    } catch (error) {
      lastError = error?.message ?? String(error)
    }
    await sleep(HEALTH_INTERVAL_MS)
  }
  throw new Error(`LocalCodingMCP did not become healthy on ${url}: ${lastError}`)
}

/**
 * The parsed `/health` payload when a LocalCodingMCP server answers, else
 * `undefined`.
 *
 * Returning the payload rather than a boolean is deliberate: it carries
 * `version`, `workspace` and `sessions`, which the settings page shows, and
 * callers that only want presence can just test it for truthiness.
 */
export async function probeExistingServer (healthUrl) {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1_500) })
    if (!response.ok) return undefined
    const body = await response.json().catch(() => ({}))
    return { status: 'ok', ...body }
  } catch {
    return undefined
  }
}

/** Free-port discovery keeps a stale process from silently hijacking our URL. */
export async function findFreePort (preferred, attempts = 20) {
  for (let offset = 0; offset < attempts; offset++) {
    const port = preferred + offset
    if (await isFreePort(port)) return port
  }
  throw new Error(`no free port in ${preferred}..${preferred + attempts - 1}`)
}

function isFreePort (port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

export class McpServerProcess {
  /**
   * @param {{ exePath: string, workspaceRoot: string, port: number, autoStart: boolean,
   *           authToken?: string, logLines?: number, logger?: { info?: Function, warn?: Function } }} options
   */
  constructor (options) {
    this.exePath = options.exePath
    this.workspaceRoot = options.workspaceRoot
    this.preferredPort = options.port
    this.autoStart = options.autoStart
    this.authToken = options.authToken
    this.maxLogLines = options.logLines ?? 200
    this.logger = options.logger

    this.port = options.port
    this.child = undefined
    this.state = 'stopped'
    this.startedAt = undefined
    this.lastError = undefined
    this.restarts = 0
    this.logs = []
    this.stopping = false
  }

  get baseUrl () {
    return `http://127.0.0.1:${this.port}`
  }

  get mcpUrl () {
    return `${this.baseUrl}/mcp`
  }

  get healthUrl () {
    return `${this.baseUrl}/health`
  }

  /** Snapshot for the settings page and diagnostics. */
  describe () {
    return {
      mode: this.child ? 'managed' : this.state === 'external' ? 'external' : this.state,
      state: this.state,
      // `owned` is what separates "I started this and will stop it" from "I
      // found somebody else's server and must leave it alone".
      owned: this.child !== undefined,
      pid: this.child?.pid,
      port: this.port,
      baseUrl: this.baseUrl,
      mcpUrl: this.mcpUrl,
      healthUrl: this.healthUrl,
      workspaceRoot: this.workspaceRoot,
      exePath: this.exePath,
      autoStart: this.autoStart,
      startedAt: this.startedAt,
      uptimeMs: this.startedAt === undefined ? undefined : Date.now() - this.startedAt,
      version: this.lastHealth?.version,
      sessions: this.lastHealth?.sessions,
      restarts: this.restarts,
      lastError: this.lastError,
      logs: this.logs.slice(-40)
    }
  }

  #log (stream, line) {
    const trimmed = line.trimEnd()
    if (!trimmed) return
    const entry = { at: Date.now(), stream, text: trimmed.slice(0, 2000) }
    this.logs.push(entry)
    if (this.logs.length > this.maxLogLines) this.logs.splice(0, this.logs.length - this.maxLogLines)
    this.logger?.info?.(`[localcoding-mcp] ${trimmed}`)
  }

  /** Adopt a server somebody else started; used when autoStart is off. */
  async attach (healthUrl) {
    const health = await probeExistingServer(healthUrl)
    if (!health) throw new Error(`no LocalCodingMCP server answers on ${healthUrl}`)
    this.port = Number(new URL(healthUrl).port)
    this.state = 'external'
    this.child = undefined
    this.lastHealth = health
    this.lastError = undefined
    return health
  }

  /** Start (or adopt) the server; safe to call repeatedly. */
  async start () {
    if (this.state === 'running' || this.state === 'external') return this.describe()

    const adopted = await probeExistingServer(this.healthUrl)
    if (adopted) {
      this.port = Number(new URL(this.healthUrl).port)
      this.state = 'external'
      this.lastHealth = adopted
      this.lastError = undefined
      return this.describe()
    }

    if (!this.autoStart) throw new Error(`no server on ${this.baseUrl} and autoStart is off`)
    if (!existsSync(this.exePath)) {
      throw new Error(`LocalCodingMCP executable not found: ${this.exePath}`)
    }

    this.stopping = false
    this.port = await findFreePort(this.preferredPort)
    const args = ['--http', '--root', this.workspaceRoot, '--port', String(this.port)]
    const env = { ...process.env }
    if (this.authToken) env.LOCAL_CODING_MCP_AUTH_TOKEN = this.authToken
    else delete env.LOCAL_CODING_MCP_AUTH_TOKEN

    this.state = 'starting'
    this.lastError = undefined
    this.child = spawn(this.exePath, args, {
      cwd: this.workspaceRoot,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    this.child.stdout.on('data', (chunk) => this.#log('stdout', String(chunk)))
    this.child.stderr.on('data', (chunk) => this.#log('stderr', String(chunk)))
    this.child.on('error', (error) => {
      this.lastError = `spawn failed: ${error.message}`
      this.#log('stderr', this.lastError)
      this.state = 'stopped'
    })
    this.child.on('exit', (code, signal) => {
      const wasStopping = this.stopping
      this.child = undefined
      this.state = 'stopped'
      this.startedAt = undefined
      this.#log('stdout', `process exited (code=${code} signal=${signal ?? 'none'}${wasStopping ? ', requested stop' : ''})`)
      if (!wasStopping && this.state === 'stopped') this.lastError = `server exited with code ${code}`
    })

    const health = await waitForHealth(this.healthUrl).catch(async (error) => {
      await this.stop()
      throw error
    })
    this.lastHealth = health
    this.state = 'running'
    this.startedAt = Date.now()
    return { ...this.describe(), health }
  }

  /** Stop the managed process; a no-op for an adopted external server. */
  async stop () {
    if (!this.child) {
      if (this.state !== 'external') this.state = 'stopped'
      return this.describe()
    }
    const child = this.child
    this.stopping = true
    const exited = new Promise((resolve) => child.once('exit', resolve))
    child.kill()
    const timer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL') }, STOP_GRACE_MS)
    try {
      await exited
    } finally {
      clearTimeout(timer)
      this.stopping = false
      this.child = undefined
      this.state = 'stopped'
      this.startedAt = undefined
    }
    return this.describe()
  }

  /** Restart, bumping the restart counter used by the settings page. */
  async restart () {
    await this.stop()
    this.restarts += 1
    return this.start()
  }

  /** Health payload from the live server, or a synthesized failure record. */
  async health () {
    const live = await probeExistingServer(this.healthUrl)
    if (live) return { ...live, managed: this.child !== undefined, pid: this.child?.pid, port: this.port }
    return {
      status: 'down',
      managed: this.child !== undefined,
      pid: this.child?.pid,
      port: this.port,
      lastError: this.lastError ?? `no response on ${this.healthUrl}`
    }
  }

  /** Release process and state on plugin disposal. */
  async dispose () {
    await this.stop()
    this.logs = []
  }
}
