/**
 * Optional browser surface: a Playwright MCP server the ChatGPT connector can drive.
 *
 * The coding tools are one half of "web ChatGPT can use my machine"; the other half is
 * the browser. `mcp.local.json` already whitelists 24 `browser_*` tools, and the tunnel
 * can forward a second MCP server just as easily as the first, so the same
 * `chatgpt.com` connector that reads files can also click, type and screenshot.
 *
 * Two details are not obvious from the launcher script:
 *
 *   - **`PLAYWRIGHT_MCP_EXTENSION_TOKEN` lives in the *user* environment block, not
 *     the process block.** A desktop app launched before the token was set never sees
 *     it in `process.env`, so we also read `HKCU\Environment` and pass the value to the
 *     child explicitly. The token is a secret: it is never logged, returned or
 *     persisted.
 *   - **The Host header must be `localhost`, not `127.0.0.1`.** The server validates
 *     inbound hosts against its allow-list and answers a raw IP with `403`, which looks
 *     exactly like "nothing is listening". Our health probe therefore uses
 *     `http://localhost:<port>/…`.
 *
 * @module dsh-localcoding-mcp/server/browser
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'

const LOG_LINES = 120
const READY_RETRIES = 60
const READY_INTERVAL_MS = 250
const STOP_GRACE_MS = 4_000

/**
 * Read one environment variable from the user environment block.
 *
 * `reg query` is used deliberately: it is the only way to read a value another
 * process wrote with `setx`, without a native binding or a registry package.
 */
async function readUserEnv (name) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn('reg.exe', ['query', 'HKCU\\Environment', '/v', name], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      resolve('')
      return
    }
    let out = ''
    child.stdout?.on('data', (chunk) => { out += String(chunk) })
    child.on('error', () => resolve(''))
    child.on('close', (code) => {
      if (code !== 0) return resolve('')
      const match = out.match(/REG_SZ\s+(.*)\s*$/m)
      resolve(match ? match[1].trim() : '')
    })
  })
}

/**
 * The extension token, from the process block first and the user block second.
 *
 * @returns {Promise<string>}
 */
export async function resolveExtensionToken () {
  const inherited = process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN
  if (inherited && inherited.trim()) return inherited.trim()
  return (await readUserEnv('PLAYWRIGHT_MCP_EXTENSION_TOKEN')).trim()
}

function isPortFree (port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

/**
 * Lifecycle owner for the Playwright MCP server process.
 *
 * Deliberately independent of the coding server: it is an extra capability, so a
 * missing extension token or an absent Chrome must never affect the tool bridge.
 */
export class BrowserMcpProcess {
  /**
   * @param {{ entry: string, port: number, autoStart: boolean, logLines?: number,
   *           args?: string[], logger?: { info?: Function, warn?: Function } }} options
   */
  constructor (options) {
    this.entry = options.entry
    this.preferredPort = options.port
    this.autoStart = options.autoStart !== false
    this.extraArgs = options.args ?? []
    this.maxLogLines = options.logLines ?? LOG_LINES
    this.logger = options.logger

    this.port = options.port
    this.child = undefined
    this.state = 'stopped'
    this.startedAt = undefined
    this.lastError = undefined
    this.logs = []
    this.token = undefined
    this.stopping = false
  }

  get baseUrl () {
    return `http://localhost:${this.port}`
  }

  get mcpUrl () {
    return `${this.baseUrl}/mcp`
  }

  describe () {
    return {
      // Whether the entry point we were configured with actually exists.
      available: existsSync(this.entry),
      state: this.state,
      owned: this.child !== undefined,
      pid: this.child?.pid,
      port: this.port,
      mcpUrl: this.mcpUrl,
      // Never the value itself — only whether one was found.
      tokenConfigured: this.token !== undefined && this.token !== '',
      entry: this.entry,
      startedAt: this.startedAt,
      uptimeMs: this.startedAt === undefined ? undefined : Date.now() - this.startedAt,
      lastError: this.lastError,
      logs: this.logs.slice(-30)
    }
  }

  #log (stream, text) {
    const trimmed = String(text).trimEnd()
    if (!trimmed) return
    this.logs.push({ at: Date.now(), stream, text: trimmed.slice(0, 1000) })
    if (this.logs.length > this.maxLogLines) this.logs.splice(0, this.logs.length - this.maxLogLines)
    this.logger?.info?.(`[localcoding-mcp/browser] ${trimmed}`)
  }

  /** Probe the server over `localhost`, never over the raw IP. */
  async health () {
    try {
      const response = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(1_500) })
      if (!response.ok) return { status: 'down', statusCode: response.status }
      return { status: 'up', ...(await response.json().catch(() => ({}))) }
    } catch (error) {
      return { status: 'down', lastError: error instanceof Error ? error.message : String(error) }
    }
  }

  async start () {
    if (this.state === 'running') return this.describe()
    if (!existsSync(this.entry)) throw new Error(`Playwright MCP entry not found: ${this.entry}`)
    if (!this.autoStart) throw new Error('browser tools are disabled (autoStart is off)')

    this.token = await resolveExtensionToken()
    if (!this.token) {
      throw new Error('PLAYWRIGHT_MCP_EXTENSION_TOKEN is not set. Set it as a user environment variable and restart the app.')
    }

    let port = this.preferredPort
    while (!(await isPortFree(port))) port += 1
    this.port = port

    const args = [
      this.entry,
      '--port', String(port),
      '--host', '127.0.0.1',
      '--extension',
      '--browser=chrome',
      '--shared-browser-context',
      '--idle-timeout', '0',
      ...this.extraArgs
    ]
    const env = { ...process.env, PLAYWRIGHT_MCP_EXTENSION_TOKEN: this.token }

    this.state = 'starting'
    this.lastError = undefined
    this.stopping = false
    this.child = spawn(process.execPath, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    this.child.stdout?.on('data', (chunk) => this.#log('stdout', String(chunk)))
    this.child.stderr?.on('data', (chunk) => this.#log('stderr', String(chunk)))
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
      if (!wasStopping) this.lastError = `browser MCP exited with code ${code}`
    })

    let lastError = 'timed out'
    for (let attempt = 0; attempt < READY_RETRIES; attempt++) {
      if (this.child?.exitCode !== null && this.child?.exitCode !== undefined) {
        await this.stop()
        throw new Error(`Playwright MCP exited during startup (code ${this.child?.exitCode ?? 'unknown'}); see the browser log`)
      }
      const health = await this.health()
      if (health.status === 'up') {
        this.state = 'running'
        this.startedAt = Date.now()
        return this.describe()
      }
      lastError = health.lastError ?? lastError
      await sleep(READY_INTERVAL_MS)
    }
    await this.stop()
    throw new Error(`Playwright MCP did not answer on ${this.baseUrl}: ${lastError}`)
  }

  async stop () {
    const child = this.child
    if (!child) {
      if (this.state !== 'external') this.state = 'stopped'
      return this.describe()
    }
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

  async dispose () {
    await this.stop()
    this.logs = []
    this.token = undefined
  }
}

/** Default entry point shipped by the LocalCodingMCP project. */
export const DEFAULT_BROWSER_ENTRY = 'E:\\ai\\aiassistant\\plugins\\LocalCodingMCP_v0_3\\mcp-accounts\\playwright-mcp\\cli.js'

/**
 * Build a browser manager from configuration.
 *
 * @param {{ entry?: string, port?: number, autoStart?: boolean, logger?: object }} options
 * @returns {BrowserMcpProcess}
 */
export function createBrowserProcess (options = {}) {
  return new BrowserMcpProcess({
    entry: String(options.entry ?? '') || DEFAULT_BROWSER_ENTRY,
    port: Number(options.port ?? 8931),
    autoStart: options.autoStart === true,
    logger: options.logger
  })
}

/** Exported for the settings page: where the default entry lives, for display only. */
export function defaultBrowserEntry () {
  return path.normalize(DEFAULT_BROWSER_ENTRY)
}
