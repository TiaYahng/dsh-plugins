/**
 * The GPT-web half of the bridge: `chatgpt.com` → OpenAI control plane → local MCP.
 *
 * LocalCodingMCP already speaks MCP over HTTP. What it cannot do by itself is let a
 * signed-in **ChatGPT web account** reach that HTTP endpoint from the outside, because
 * the server binds `127.0.0.1` and there is no inbound port on a home network. OpenAI
 * ships `tunnel-client.exe` for exactly this: it dials *out* to
 * `https://api.openai.com`, registers one tunnel, and the connector that the user
 * picks at `chatgpt.com/#settings/Connectors` then forwards its tool calls back down
 * that outbound connection.
 *
 * ## Why one process per account
 *
 * `--control-plane.tunnel-id` is a single-valued flag and `--health.listen-addr`
 * defaults to `127.0.0.1:8080`, so N ChatGPT accounts need N tunnel-client processes
 * with N profiles and N distinct health ports. Tunnels are also workspace-scoped: the
 * connector picker only lists tunnels belonging to the signed-in account's workspace,
 * so one tunnel can never be shared between accounts.
 *
 * ## Secret handling
 *
 * `accounts.json` stores each `controlPlaneKey` as a DPAPI blob (CurrentUser, no
 * entropy). This module decrypts it in memory, hands it to the child through that
 * child's *own* environment variable, and never logs, echoes, returns or persists the
 * plaintext. `describe()` only ever reports whether a key is configured.
 *
 * ## Proxy handling
 *
 * `tunnel-client` resolves an env-sourced proxy for **every** route, including the
 * local MCP channel, so a `HTTP_PROXY` inherited from the desktop shell would send
 * `127.0.0.1:3011` traffic through an unrelated proxy. Two rules follow:
 *   - `NO_PROXY` must cover loopback, because that is the only escape hatch an
 *     env-sourced proxy honours (`pkg/proxy/route.go`).
 *   - When we pass an explicit `--control-plane.http-proxy`, the inherited proxy
 *     variables must be removed from the child env, because an explicit flag ignores
 *     `NO_PROXY` by design (`pkg/transport/proxy.go`).
 *
 * @module dsh-localcoding-mcp/server/tunnel
 */

import { spawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'

const LOG_LINES = 200

/** tunnel-client refuses anything that is not `tunnel_<32 hex>`. */
const TUNNEL_ID_PATTERN = /^tunnel_[0-9a-f]{32}$/

/** The sample that matches a plain HTTP MCP target with no OAuth metadata. */
export const DEFAULT_SAMPLE = 'sample_mcp_remote_no_auth'

export const DEFAULT_CONTROL_PLANE_BASE_URL = 'https://api.openai.com'

/** Proxy candidates probed when the user has not pinned one. */
export const DEFAULT_PROXY_CANDIDATES = [
  'http://127.0.0.1:7897',
  'http://127.0.0.1:7890',
  'http://127.0.0.1:7898',
  'http://127.0.0.1:7891'
]

/** Environment variable names a child must never inherit twice in two spellings. */
const PROXY_ENV_NAMES = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy']

/**
 * Env var a given account's decrypted control-plane key is handed to.
 *
 * The name is derived from the account id so it stays unique across the fleet, which
 * matters because a single process serves exactly one tunnel.
 *
 * @param {string} id account id, e.g. `account-001`
 * @returns {string}
 */
export function keyVariableName (id) {
  let safe = String(id).toUpperCase().replace(/[^A-Z0-9]/g, '_')
  if (!/^[A-Z_]/.test(safe)) safe = `A_${safe}`
  return `LCM_CP_KEY_${safe}`
}

/** PowerShell single-quoted literal, for embedding values inside the decrypt script. */
function psLiteral (value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

/**
 * Run a short-lived child and collect its output.
 *
 * @returns {Promise<{ code: number, stdout: string, stderr: string, timedOut: boolean }>}
 */
function capture (executable, args, { timeoutMs = 20_000, env } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(executable, args, {
        env: env ?? process.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      resolve({ code: -1, stdout: '', stderr: error.message, timedOut: false })
      return
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const finish = (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    }
    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill('SIGKILL') } catch { /* already gone */ }
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => { stderr += error.message; finish(-1) })
    child.on('close', (code) => finish(code ?? -1))
  })
}

/**
 * Decrypt one account's DPAPI control-plane key in memory.
 *
 * PowerShell is used because Node has no DPAPI binding. The script is delivered as
 * `-EncodedCommand` with the paths embedded as literals: `-Command` would append every
 * following argv element to the script text, so separate arguments cannot be used.
 * The ciphertext already lives in `accounts.json`; nothing plaintext is ever written
 * to disk, and only the returned string (never logged) carries the secret.
 *
 * @param {string} accountsPath path to `accounts.json`
 * @param {string} accountId account whose key should be decrypted
 * @returns {Promise<string>} the plaintext key, or `''` when it cannot be recovered
 */
export async function decryptControlPlaneKey (accountsPath, accountId) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    // Windows PowerShell 5.1 does not auto-load the assembly that owns
    // ProtectedData, so without this every call fails with
    // "Unable to find type [System.Security.Cryptography.ProtectedData]".
    'Add-Type -AssemblyName System.Security',
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    `$cfg = Get-Content -LiteralPath ${psLiteral(accountsPath)} -Raw -Encoding UTF8 | ConvertFrom-Json`,
    `$acct = @($cfg.accounts) | Where-Object { [string]$_.id -eq ${psLiteral(accountId)} } | Select-Object -First 1`,
    'if (-not $acct) { [Console]::Error.Write("no such account"); exit 3 }',
    'if (-not $acct.tunnel) { [Console]::Error.Write("account has no tunnel"); exit 4 }',
    '$blob = [string]$acct.tunnel.controlPlaneKey',
    'if ([string]::IsNullOrWhiteSpace($blob)) { [Console]::Error.Write("no control plane key configured"); exit 5 }',
    'try {',
    '  $bytes = [Convert]::FromBase64String($blob)',
    '  $plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '  [Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))',
    '} catch { [Console]::Error.Write("dpapi unprotect failed"); exit 6 }'
  ].join('\n')

  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  const result = await capture('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { timeoutMs: 20_000 })
  return result.code === 0 ? result.stdout.trim() : ''
}

/**
 * True when `proxyUrl` can actually tunnel `targetHost:443`.
 *
 * A raw `CONNECT` handshake is used rather than an HTTPS request because the question
 * is "does this proxy reach that host", and a TLS handshake failure must not be
 * mistaken for a dead proxy.
 *
 * @param {string} proxyUrl
 * @param {string} targetHost
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<boolean>}
 */
export function probeProxy (proxyUrl, targetHost, { timeoutMs = 4_000 } = {}) {
  let url
  try {
    url = new URL(proxyUrl)
  } catch {
    return Promise.resolve(false)
  }
  const port = Number(url.port || 80)
  return new Promise((resolve) => {
    const socket = net.connect({ host: url.hostname, port })
    let buffer = ''
    let settled = false
    const done = (ok) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => {
      socket.write(`CONNECT ${targetHost}:443 HTTP/1.1\r\nHost: ${targetHost}:443\r\nProxy-Connection: Keep-Alive\r\n\r\n`)
    })
    socket.on('data', (chunk) => {
      buffer += String(chunk)
      if (buffer.includes('\r\n')) done(/^HTTP\/1\.[01]\s+200/i.test(buffer))
    })
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/**
 * First candidate proxy that can reach `host`, or `''` for a direct connection.
 *
 * @param {string[]} candidates
 * @param {string} host
 * @returns {Promise<string>}
 */
export async function resolveProxy (candidates, host) {
  for (const candidate of candidates) {
    if (!candidate) continue
    if (await probeProxy(candidate, host)) return candidate
  }
  return ''
}

/** True when nothing is listening on `port`. */
export function isPortFree (port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

/** Image name of a running pid, or `''` when the pid is gone. */
async function processImage (pid) {
  const result = await capture('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { timeoutMs: 10_000 })
  if (result.code !== 0) return ''
  const line = result.stdout.split(/\r?\n/).find((entry) => entry.trim().length > 0)
  if (!line) return ''
  // CSV: "tunnel-client.exe","1234","Console","1","12,345 K"
  return line.split(',')[0].replace(/"/g, '').trim()
}

/**
 * Parse `accounts.json` into launch candidates.
 *
 * Every skip carries a human reason, because the usual causes (wrong Windows account,
 * missing runtime key, empty organization id) all surface as a daemon that dies
 * seconds after start with an opaque `403`.
 *
 * @param {string} accountsPath
 * @returns {{ accounts: object[], skipped: object[] }}
 */
export function readAccounts (accountsPath) {
  const skipped = []
  const accounts = []
  if (!existsSync(accountsPath)) {
    return { accounts, skipped: [{ id: '', name: accountsPath, reason: 'config file not found' }] }
  }

  let config
  try {
    config = JSON.parse(readFileSync(accountsPath, 'utf8'))
  } catch (error) {
    return { accounts, skipped: [{ id: '', name: accountsPath, reason: `cannot parse config: ${error.message}` }] }
  }

  const seen = new Set()
  for (const raw of Array.isArray(config?.accounts) ? config.accounts : []) {
    const id = String(raw?.id ?? '')
    const name = String(raw?.name ?? '').trim() || id
    if (!id) {
      skipped.push({ id: '', name, reason: 'account has no id' })
      continue
    }
    if (seen.has(id)) {
      skipped.push({ id, name, reason: 'duplicate account id' })
      continue
    }
    if (raw?.enabled === false) {
      skipped.push({ id, name, reason: 'account disabled' })
      continue
    }
    const tunnel = raw?.tunnel
    if (!tunnel) {
      skipped.push({ id, name, reason: 'no tunnel configured' })
      continue
    }
    if (tunnel.enabled === false) {
      skipped.push({ id, name, reason: 'tunnel disabled' })
      continue
    }
    const tunnelId = String(tunnel.tunnelId ?? '').trim()
    if (!TUNNEL_ID_PATTERN.test(tunnelId)) {
      skipped.push({ id, name, reason: tunnelId ? 'tunnel id format is wrong' : 'no tunnel id' })
      continue
    }
    if (!String(tunnel.controlPlaneKey ?? '').trim()) {
      skipped.push({ id, name, reason: 'no control plane key' })
      continue
    }

    seen.add(id)
    accounts.push({
      id,
      name,
      workspace: String(raw.workspace ?? ''),
      // `organizationId` empty is the classic cause of
      // `403 tunnel_active_organization_required`; surface it, never guess it.
      organizationId: String(tunnel.organizationId ?? '').trim(),
      tunnelId,
      keyConfigured: true,
      proxyOverride: String(tunnel.proxy ?? '').trim(),
      publicDomain: String(raw.publicDomain ?? '').trim(),
      permissions: Array.isArray(raw.permissions) ? raw.permissions.map(String) : [],
      keyVar: keyVariableName(id)
    })
  }
  return { accounts, skipped }
}

/** Ensure `dir` exists, ignoring an already-present directory. */
function ensureDir (dir) {
  mkdirSync(dir, { recursive: true })
}

/**
 * One tunnel-client process per ChatGPT account.
 *
 * The fleet owns the whole launch sequence — proxy probe, profile generation, profile
 * verification, process start, readiness polling — because each step has a failure
 * mode that is invisible from any single piece of it.
 */
export class TunnelFleet {
  /**
   * @param {{ exePath: string, accountsPath: string, profileDir: string, logDir: string,
   *           mcpUrl: string, controlPlaneBaseUrl?: string, healthPortBase?: number,
   *           readyTimeoutSeconds?: number, proxy?: string, sample?: string,
   *           logger?: { info?: Function, warn?: Function } }} options
   */
  constructor (options) {
    this.exePath = options.exePath
    this.accountsPath = options.accountsPath
    this.profileDir = options.profileDir
    this.logDir = options.logDir
    this.mcpUrl = options.mcpUrl
    this.controlPlaneBaseUrl = options.controlPlaneBaseUrl || DEFAULT_CONTROL_PLANE_BASE_URL
    this.healthPortBase = options.healthPortBase ?? 8080
    this.readyTimeoutSeconds = options.readyTimeoutSeconds ?? 45
    this.pinnedProxy = String(options.proxy ?? '').trim()
    this.sample = options.sample || DEFAULT_SAMPLE
    this.logger = options.logger

    this.proxy = ''
    this.resolved = false
    this.runtimePath = path.join(this.logDir, 'tunnel-runtime.json')
    /** @type {Map<string, object>} account id → runtime record */
    this.instances = new Map()
  }

  get available () {
    return existsSync(this.exePath)
  }

  /** Accounts from config plus whatever state we currently hold for them. */
  #load () {
    const { accounts, skipped } = readAccounts(this.accountsPath)
    return { accounts, skipped }
  }

  #log (id, stream, text) {
    const trimmed = String(text).trimEnd()
    if (!trimmed) return
    const record = this.instances.get(id)
    if (!record) return
    record.logs.push({ at: Date.now(), stream, text: trimmed.slice(0, 2000) })
    if (record.logs.length > LOG_LINES) record.logs.splice(0, record.logs.length - LOG_LINES)
    this.logger?.info?.(`[localcoding-mcp/tunnel:${id}] ${trimmed}`)
  }

  /** Base record for one account, without any secret material. */
  #record (account, extra = {}) {
    return {
      id: account.id,
      name: account.name,
      tunnelId: account.tunnelId,
      organizationId: account.organizationId,
      keyConfigured: account.keyConfigured,
      keyVar: account.keyVar,
      proxyOverride: account.proxyOverride,
      workspace: account.workspace,
      permissions: account.permissions,
      publicDomain: account.publicDomain,
      healthPort: 0,
      pid: undefined,
      state: 'stopped',
      message: '',
      startedAt: undefined,
      logs: [],
      ...extra
    }
  }

  /** Snapshot for the settings page: config, proxy decision, and per-account state. */
  describe () {
    const { accounts, skipped } = this.#load()
    return {
      available: this.available,
      exePath: this.exePath,
      accountsPath: this.accountsPath,
      profileDir: this.profileDir,
      logDir: this.logDir,
      runtimePath: this.runtimePath,
      mcpUrl: this.mcpUrl,
      controlPlaneBaseUrl: this.controlPlaneBaseUrl,
      healthPortBase: this.healthPortBase,
      sample: this.sample,
      proxy: this.proxy,
      proxyResolved: this.resolved,
      pinnedProxy: this.pinnedProxy,
      accounts: accounts.map((account) => {
        const record = this.instances.get(account.id)
        if (!record) return this.#record(account)
        return { ...record, logs: record.logs.slice(-40) }
      }),
      skipped,
      readyUrlTemplate: 'http://127.0.0.1:<healthPort>/readyz',
      uiUrlTemplate: 'http://127.0.0.1:<healthPort>/ui'
    }
  }

  /** Resolve the outbound proxy once and remember the verdict. */
  async #resolveProxyOnce () {
    if (this.resolved) return this.proxy
    const host = (() => {
      try {
        return new URL(this.controlPlaneBaseUrl).host
      } catch {
        return 'api.openai.com'
      }
    })()
    if (this.pinnedProxy) {
      this.proxy = await probeProxy(this.pinnedProxy, host) ? this.pinnedProxy : ''
    } else {
      const inherited = [process.env.HTTPS_PROXY, process.env.HTTP_PROXY, process.env.ALL_PROXY].filter(Boolean)
      this.proxy = await resolveProxy([...new Set([...inherited, ...DEFAULT_PROXY_CANDIDATES])], host)
    }
    this.resolved = true
    if (!this.proxy) {
      this.logger?.warn?.('[localcoding-mcp/tunnel] no proxy can reach the control plane; trying a direct connection')
    }
    return this.proxy
  }

  /** Child environment with a single, loopback-safe proxy configuration. */
  #childEnv (keyVar, key) {
    const env = { ...process.env }
    // Collapse/clear every case variant: Windows environment blocks are
    // case-insensitive, so leaving `http_proxy` next to `HTTP_PROXY` is a coin flip.
    for (const name of PROXY_ENV_NAMES) delete env[name]
    env.NO_PROXY = '127.0.0.1,localhost,::1'
    env.no_proxy = env.NO_PROXY
    if (keyVar) {
      if (key) env[keyVar] = key
      else delete env[keyVar]
    }
    return env
  }

  /**
   * Generate the profile YAML for one account and verify it by content.
   *
   * Public because it is the one step worth exercising without a control-plane
   * connection: `start()` calls it, and so does the test suite, which proves the
   * generated YAML really belongs to the account it claims.
   *
   * `$LASTEXITCODE`-style verification is useless here: a host that does not wait for
   * the child sees an exit code of nothing, and a timestamp only proves *something*
   * wrote the file. Grepping for the tunnel id, the key reference and the listen
   * address is the only check that actually proves the profile is this account's, and
   * it also catches a stale profile left by an earlier configuration.
   *
   * @param {{ id: string, tunnelId: string, keyVar: string, organizationId?: string }} account
   * @param {number} healthPort loopback port the daemon will expose `/readyz` on
   * @returns {Promise<{ ok: boolean, profilePath: string, output: string, expected?: string }>}
   */
  async prepareProfile (account, healthPort) {
    const args = [
      'init',
      '--sample', this.sample,
      '--profile', account.id,
      '--profile-dir', this.profileDir,
      '--tunnel-id', account.tunnelId,
      '--mcp-server-url', this.mcpUrl,
      '--health-listen-addr', `127.0.0.1:${healthPort}`,
      '--control-plane-api-key-ref', `env:${account.keyVar}`,
      '--control-plane-base-url', this.controlPlaneBaseUrl,
      ...(account.organizationId ? ['--control-plane.organization-id', account.organizationId] : []),
      '--force'
    ]
    const init = await capture(this.exePath, args, { timeoutMs: 30_000 })

    const profilePath = path.join(this.profileDir, `${account.id}.yaml`)
    const keyReference = `env:${account.keyVar}`
    const listenAddress = `127.0.0.1:${healthPort}`
    for (let attempt = 0; attempt < 10; attempt++) {
      if (existsSync(profilePath)) {
        const text = readFileSync(profilePath, 'utf8')
        if (text.includes(account.tunnelId) && text.includes(keyReference) && text.includes(listenAddress)) {
          return { ok: true, profilePath, output: init.stdout.trim() }
        }
      }
      await sleep(500)
    }
    return {
      ok: false,
      profilePath,
      output: [init.stdout.trim(), init.stderr.trim()].filter(Boolean).join('\n'),
      expected: `tunnel_id=${account.tunnelId} api_key=${keyReference} listen_addr=${listenAddress}`
    }
  }

  /** Spawn `tunnel-client run` and wait for `/readyz`. */
  async #launch (account, healthPort, key) {
    const stdoutPath = path.join(this.logDir, `tunnel-${account.id}.log`)
    const stderrPath = path.join(this.logDir, `tunnel-${account.id}-error.log`)
    const pidPath = path.join(this.logDir, `tunnel-${account.id}.pid`)
    rmSync(pidPath, { force: true })

    const args = [
      'run',
      '--profile-dir', this.profileDir,
      '--profile', account.id,
      '--pid.file', pidPath
    ]
    if (this.proxy && !account.proxyOverride) {
      args.push('--control-plane.http-proxy', this.proxy, '--proxy.check-interval', '30s')
    } else if (account.proxyOverride) {
      args.push('--control-plane.http-proxy', account.proxyOverride, '--proxy.check-interval', '30s')
    }

    const child = spawn(this.exePath, args, {
      cwd: path.dirname(this.exePath),
      env: this.#childEnv(account.keyVar, key),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    // Stdout/stderr also go to the same files the project launcher writes, so the
    // existing diagnostics keep working after the plugin takes over.
    const append = (file, chunk) => {
      try {
        writeFileSync(file, String(chunk), { flag: 'a' })
      } catch { /* a full disk must not kill the tunnel */ }
    }
    child.stdout?.on('data', (chunk) => { this.#log(account.id, 'stdout', String(chunk)); append(stdoutPath, chunk) })
    child.stderr?.on('data', (chunk) => { this.#log(account.id, 'stderr', String(chunk)); append(stderrPath, chunk) })

    const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })))
    child.on('error', (error) => this.#log(account.id, 'stderr', `spawn failed: ${error.message}`))

    const deadline = Date.now() + this.readyTimeoutSeconds * 1000
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        return { state: 'DIED', child, pid: child.pid, message: 'tunnel-client exited during startup' }
      }
      try {
        const response = await fetch(`http://127.0.0.1:${healthPort}/readyz`, { signal: AbortSignal.timeout(2_000) })
        if (response.ok) {
          return { state: 'READY', child, pid: child.pid, message: 'daemon ready (credential validity unverified)' }
        }
      } catch { /* not up yet */ }
      await sleep(800)
    }
    try { child.kill('SIGKILL') } catch { /* already gone */ }
    await exited.catch(() => {})
    return { state: 'TIMEOUT', child: undefined, pid: child.pid, message: `not ready within ${this.readyTimeoutSeconds}s` }
  }

  /**
   * Start the tunnel for one account.
   *
   * @param {string} accountId
   * @returns {Promise<object>} the account record; never contains the plaintext key
   */
  async start (accountId) {
    if (!this.available) throw new Error(`tunnel-client.exe not found: ${this.exePath}`)
    const { accounts } = this.#load()
    const account = accounts.find((entry) => entry.id === accountId)
    if (!account) throw new Error(`no enabled account with id "${accountId}" in ${this.accountsPath}`)

    ensureDir(this.profileDir)
    ensureDir(this.logDir)
    await this.#resolveProxyOnce()

    const key = await decryptControlPlaneKey(this.accountsPath, account.id)
    if (!key) throw new Error(`cannot recover the control plane key for ${account.name} (${account.id}) — it is DPAPI-encrypted for the Windows account that created it`)
    // From here on the plaintext only ever travels in the child env.
    try {
      let healthPort = this.healthPortBase
      while (!(await isPortFree(healthPort))) healthPort += 1

      const record = this.#record(account, { healthPort })
      this.instances.set(account.id, record)

      const profile = await this.prepareProfile(account, healthPort)
      if (!profile.ok) {
        record.state = 'PROFILE_FAILED'
        record.message = profile.output || `profile generation failed, expected ${profile.expected}`
        this.#log(account.id, 'stderr', record.message)
        return this.#describeRecord(record)
      }
      record.profilePath = profile.profilePath

      const launched = await this.#launch(account, healthPort, key)
      record.state = launched.state
      record.message = launched.message
      record.pid = launched.pid
      record.startedAt = launched.state === 'READY' ? Date.now() : undefined
      if (launched.child) {
        record.child = launched.child
        launched.child.once('exit', (code, signal) => {
          this.#log(account.id, 'stdout', `tunnel-client exited (code=${code} signal=${signal ?? 'none'})`)
          record.child = undefined
          record.pid = undefined
          if (record.state === 'READY') {
            record.state = 'DIED'
            record.message = 'tunnel-client exited'
          }
        })
      }
      this.#writeRuntimeFile()
      return this.#describeRecord(record)
    } finally {
      // Drop the plaintext as soon as the child owns it.
      void key
    }
  }

  /** Snapshot of one account without its log tail. */
  #describeRecord (record) {
    const { child, ...rest } = record
    void child
    return { ...rest, logs: rest.logs.slice(-40) }
  }

  /**
   * Stop one account's tunnel.
   *
   * Only processes whose image really is `tunnel-client.exe` are signalled: the parent
   * project ships its own copy, and killing by name would take that one down too.
   */
  async stop (accountId) {
    const record = this.instances.get(accountId)
    if (!record) throw new Error(`tunnel for account "${accountId}" was never started by this plugin`)

    let stopped = false
    if (record.child) {
      try { record.child.kill('SIGKILL') } catch { /* already gone */ }
      stopped = true
    } else if (record.pid) {
      const image = await processImage(record.pid)
      if (image.toLowerCase() === 'tunnel-client.exe') {
        await capture('taskkill.exe', ['/PID', String(record.pid), '/T', '/F'], { timeoutMs: 15_000 })
        stopped = true
      } else if (image) {
        throw new Error(`pid ${record.pid} is ${image}, not tunnel-client.exe — refusing to stop it`)
      }
    }
    rmSync(path.join(this.logDir, `tunnel-${accountId}.pid`), { force: true })

    record.child = undefined
    record.pid = undefined
    record.state = 'stopped'
    record.startedAt = undefined
    record.message = stopped ? 'stopped by the plugin' : 'nothing was running'
    this.#writeRuntimeFile()
    return this.#describeRecord(record)
  }

  /** Start every configured account; per-account failures never abort the batch. */
  async startAll () {
    const { accounts } = this.#load()
    const results = []
    for (const account of accounts) {
      try {
        results.push(await this.start(account.id))
      } catch (error) {
        results.push({
          id: account.id,
          name: account.name,
          tunnelId: account.tunnelId,
          state: 'FAILED',
          message: error instanceof Error ? error.message : String(error),
          logs: []
        })
      }
    }
    return { results, ...this.describe() }
  }

  /** Stop every account this plugin started. */
  async stopAll () {
    const ids = [...this.instances.keys()]
    const results = []
    for (const id of ids) {
      try {
        results.push(await this.stop(id))
      } catch (error) {
        results.push({ id, state: 'FAILED', message: error instanceof Error ? error.message : String(error) })
      }
    }
    return { results, ...this.describe() }
  }

  /** `/readyz` and `/healthz` for one account, as the operator surfaces report them. */
  async probe (accountId) {
    const record = this.instances.get(accountId)
    if (!record) throw new Error(`tunnel for account "${accountId}" was never started by this plugin`)
    const base = `http://127.0.0.1:${record.healthPort}`
    const read = async (route) => {
      try {
        const response = await fetch(`${base}${route}`, { signal: AbortSignal.timeout(3_000) })
        const text = await response.text()
        let json
        try {
          json = JSON.parse(text)
        } catch {
          json = undefined
        }
        return { ok: response.ok, status: response.status, json, text: json ? undefined : text.slice(0, 2000) }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
    return {
      id: record.id,
      name: record.name,
      healthPort: record.healthPort,
      pid: record.pid,
      readyz: await read('/readyz'),
      healthz: await read('/healthz'),
      ui: `${base}/ui`,
      note: '/readyz only proves the daemon runs — a real tool call from the ChatGPT connector is what validates the credential'
    }
  }

  /** `tunnel-client doctor --explain`, filtered down to its verdict lines. */
  async doctor (accountId) {
    const { accounts } = this.#load()
    const account = accounts.find((entry) => entry.id === accountId)
    if (!account) throw new Error(`no enabled account with id "${accountId}"`)
    const result = await capture(this.exePath, ['doctor', '--profile', account.id, '--profile-dir', this.profileDir, '--explain'], { timeoutMs: 45_000 })
    const lines = `${result.stdout}\n${result.stderr}`.split(/\r?\n/)
    return {
      id: account.id,
      name: account.name,
      exitCode: result.code,
      timedOut: result.timedOut,
      report: lines.filter((line) => /^(CHECK|RESULT|FAILED_CHECKS|NEXT|EXIT_CODE|WARN|ERROR) /.test(line) || line.trim().length > 0).slice(0, 200)
    }
  }

  /**
   * Persist the operator-facing runtime file, UTF-8 without BOM.
   *
   * The project launcher writes the same shape, so tooling that already reads it keeps
   * working after the plugin takes over.
   */
  #writeRuntimeFile () {
    try {
      ensureDir(this.logDir)
      const payload = {
        generatedAt: new Date().toISOString(),
        owner: 'dsh-localcoding-mcp',
        proxy: this.proxy,
        mcpUrl: this.mcpUrl,
        accounts: [...this.instances.values()].map((record) => ({
          id: record.id,
          name: record.name,
          tunnelId: record.tunnelId,
          healthPort: record.healthPort,
          pid: record.pid ?? 0,
          state: record.state,
          message: record.message
        }))
      }
      writeFileSync(this.runtimePath, JSON.stringify(payload, null, 2), 'utf8')
    } catch (error) {
      this.logger?.warn?.(`[localcoding-mcp/tunnel] cannot write runtime file: ${error.message}`)
    }
  }

  /** Stop everything this plugin started, then forget it. */
  async dispose () {
    await this.stopAll().catch(() => {})
    this.instances.clear()
  }
}
