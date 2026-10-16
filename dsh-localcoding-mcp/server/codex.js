/**
 * Reverse delegation: run a coding task inside Codex CLI.
 *
 * Direction matters. The bridge (bridge.js) exposes LocalCodingMCP tools to the
 * DeepSeek agent; this module runs `codex exec` so the DeepSeek agent can hand a
 * whole coding task to Codex. The two compose: once the plugin registers our
 * `/mcp` endpoint with `codex mcp add --url`, the Codex child process itself calls
 * back into LocalCodingMCP.
 */

import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_CODEX_PATH = path.join(
  process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local'),
  'OpenAI', 'Codex', 'bin', 'codex.exe'
)

const MAX_CAPTURED_CHARS = 200_000

/** Locate codex.exe: explicit setting, then the documented default install. */
export function resolveCodexPath (configured) {
  const candidates = [
    configured,
    process.env.CODEX_CLI_PATH,
    DEFAULT_CODEX_PATH,
    path.join(homedir(), '.codex', 'bin', 'codex.exe')
  ].filter((entry) => typeof entry === 'string' && entry.length > 0)
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * Cheap readiness probe. `codex login status` exits non-zero when no account is
 * linked, which is the exact failure that otherwise surfaces as a silent hang.
 *
 * It is NOT a usable readiness signal on its own. A config that points Codex at
 * a third-party relay (`model_provider = "custom"` + `base_url` + a bearer
 * token, `requires_openai_auth = false`) has no `auth.json` and therefore always
 * reports "Not logged in" even when the relay token works fine — and vice versa,
 * a real login still fails if the relay is down. So we additionally read the
 * provider config and report what is actually configured.
 */
export async function probeCodex (codexPath, options = {}) {
  if (!codePathGuard(codexPath)) {
    return { available: false, loggedIn: false, version: undefined, reason: 'codex.exe not found — set its path in settings' }
  }
  const result = await runCodex(codexPath, ['login', 'status'], { timeoutMs: options.timeoutMs ?? 15_000 })
  const output = `${result.stdout}\n${result.stderr}`
  const version = /\b(\d+\.\d+\.\d+[\w.-]*)\b/.exec(result.stdout)?.[1]
  const provider = readProviderConfig()
  if (result.code === 0) {
    return { available: true, loggedIn: true, version, reason: undefined, provider, account: output.trim().split('\n')[0] }
  }
  const notLoggedIn = /not logged in|not authenticated|no account/i.test(output)
  // A relay config authenticates with its own token, not with an OpenAI login.
  if (notLoggedIn && provider?.relay) {
    return {
      available: true,
      loggedIn: true,
      version,
      provider,
      reason: `codex is pointed at the third-party relay ${provider.baseUrl} and authenticates with a bearer token, so \`codex login status\` reports "Not logged in" by design — this is not the real readiness signal`
    }
  }
  return {
    available: true,
    loggedIn: false,
    version,
    provider,
    reason: notLoggedIn
      ? 'codex is installed but not logged in — run `codex login` (or `codex login --api-key`) in a terminal'
      : `codex login status failed (exit ${result.code}): ${output.trim().slice(0, 400)}`
  }
}

function codePathGuard (codexPath) {
  return typeof codexPath === 'string' && codexPath.length > 0
}

/**
 * Read `~/.codex/config.toml` just far enough to learn which model provider is
 * active. A relay provider means a bearer token in the config, not a login.
 * Values other than the two public ones (host, whether a token is present) are
 * never returned — the token itself must not leak into a UI payload.
 */
export function readProviderConfig () {
  const file = path.join(homedir(), '.codex', 'config.toml')
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  const providerName = /^\s*model_provider\s*=\s*"([^"]*)"/m.exec(text)?.[1]
  const baseUrl = /^\s*base_url\s*=\s*"([^"]*)"/m.exec(text)?.[1]
  const hasToken = /^\s*experimental_bearer_token\s*=\s*"\S+"/m.test(text)
  const wireApi = /^\s*wire_api\s*=\s*"([^"]*)"/m.exec(text)?.[1]
  const relay = providerName !== undefined && providerName !== 'openai'
  return {
    name: providerName ?? 'openai',
    baseUrl: baseUrl ?? '',
    wireApi,
    hasToken,
    relay
  }
}

/** One-shot child process execution with a hard timeout. */
function runCodex (exePath, args, { timeoutMs = 30_000, cwd, signal, env, stdin } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(exePath, args, {
        cwd,
        env: env ?? process.env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (error) {
      resolve({ code: -1, stdout: '', stderr: `spawn failed: ${error.message}`, timedOut: false })
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
      signal?.removeEventListener('abort', onAbort)
      resolve({ code, stdout, stderr, timedOut })
    }
    // `codex exec` starts MCP servers and sandboxes as grandchildren, and those
    // keep the inherited stdout/stderr pipes open. Killing only the direct child
    // therefore does NOT close the streams, so waiting for `close` after a
    // timeout can overshoot the budget by minutes. Resolve the promise the moment
    // the deadline fires and tear the pipes down ourselves.
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
      child.stdout?.destroy()
      child.stderr?.destroy()
      finish(-1)
    }, timeoutMs)
    const onAbort = () => {
      killTree(child)
      finish(-2)
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout?.on('data', (chunk) => { if (stdout.length < MAX_CAPTURED_CHARS) stdout += chunk })
    child.stderr?.on('data', (chunk) => { if (stderr.length < MAX_CAPTURED_CHARS) stderr += chunk })
    child.on('error', (error) => {
      stderr += `\n${error.message}`
      finish(-1)
    })
    child.on('close', (code) => finish(code ?? -1))

    // Close stdin unconditionally. Left open, codex prints
    // "Reading additional input from stdin..." and waits for input that never
    // comes, so a run that would otherwise finish never starts.
    if (child.stdin) child.stdin.end(stdin ?? '')
    else child.stdin?.end?.()
  })
}

/**
 * Kill a child and everything it spawned. On Windows `child.kill()` only
 * signals the direct child, and signal names other than SIGKILL are not real.
 */
function killTree (child) {
  if (!child?.pid) return
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      }).unref()
      return
    } catch {
      // fall through to the plain kill below
    }
  }
  try { child.kill('SIGKILL') } catch { /* already gone */ }
}

/**
 * Register our MCP endpoint with the Codex CLI so Codex child processes can call
 * LocalCodingMCP. `codex mcp add` is itself idempotent — re-adding a name
 * overwrites the row in place (verified) — so we only verify afterwards.
 */
export async function ensureCodexMcpServer (codexPath, name, url, options = {}) {
  if (!codexPath) throw new Error('codex.exe not found — set its path in settings')
  const add = await runCodex(codexPath, ['mcp', 'add', name, '--url', url], {
    timeoutMs: options.timeoutMs ?? 30_000
  })
  if (add.code !== 0) {
    throw new Error(`codex mcp add failed (exit ${add.code}): ${(add.stderr || add.stdout).trim().slice(0, 600)}`)
  }
  const verify = await runCodex(codexPath, ['mcp', 'list'], { timeoutMs: 20_000 })
  if (!verify.stdout.includes(name) || !verify.stdout.includes(url)) {
    throw new Error([
      `codex mcp add ${name} --url ${url} did not take effect`,
      verify.stderr.trim(),
      verify.stdout.trim().slice(0, 500)
    ].filter(Boolean).join('\n'))
  }
  return { name, url, registered: true, output: verify.stdout.trim() }
}

/** Remove our MCP entry from Codex config (used by the "unregister" button). */
export async function removeCodexMcpServer (codexPath, name) {
  if (!codexPath) throw new Error('codex.exe not found — set its path in settings')
  const result = await runCodex(codexPath, ['mcp', 'remove', name], { timeoutMs: 20_000 })
  if (result.code !== 0 && !/not found/i.test(result.stderr)) {
    throw new Error(`codex mcp remove failed: ${result.stderr.trim().slice(0, 400)}`)
  }
  return { name, removed: true }
}

/** Read back the MCP servers Codex currently knows about, split by transport. */
export async function listCodexMcpServers (codexPath) {
  if (!codexPath) return []
  const result = await runCodex(codexPath, ['mcp', 'list'], { timeoutMs: 20_000 })
  if (result.code !== 0) return []
  const servers = []
  let transport = 'stdio'
  for (const raw of result.stdout.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    // `codex mcp list` prints two tables with different column layouts.
    if (/^Name\s+Url\b/i.test(line)) { transport = 'http'; continue }
    if (/^Name\s+Command\b/i.test(line)) { transport = 'stdio'; continue }
    const name = line.split(/\s{2,}/)[0]
    if (!name || name === 'Name' || !/^[A-Za-z0-9_.-]+$/.test(name)) continue
    const url = transport === 'http' ? /https?:\/\/\S+/.exec(line)?.[0] : undefined
    servers.push({ name, transport, ...url ? { url } : {} })
  }
  return servers
}

/** DSH tool definition for delegating a task to Codex. */
export function buildCodexToolDefinition (deps) {
  // One probe per minute shared by every caller: `codex exec` hangs when the
  // model endpoint is unreachable, and that hang is indistinguishable from a
  // slow task, so the cheap pre-flight is what makes that failure legible.
  let probeCache
  let probedAt = 0
  const ensureReady = async (codexPath) => {
    if (Date.now() - probedAt > 60_000 || !probeCache) {
      probeCache = await probeCodex(codexPath).catch(() => undefined)
      probedAt = Date.now()
    }
    if (probeCache?.available && probeCache.loggedIn === false) {
      throw new Error(`codex cannot run: ${probeCache.reason}`)
    }
    return probeCache?.provider ?? deps.providerConfig
  }

  return {
    name: 'lcm_codex_task',
    description: [
      'Delegate a coding task to the Codex CLI (codex.exe), which runs as its own agent with its own tools',
      `— including our LocalCodingMCP server at ${deps.mcpUrl} once registered.`,
      'Use this when a task benefits from a second autonomous agent: a self-contained change, a review pass, or a long refactor.',
      'The Codex child edits real files in the given workspace directory, so give it a precise, bounded instruction.'
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Self-contained instruction for Codex, including the exact files and the acceptance criteria.' },
        workspace: { type: 'string', description: 'Absolute directory Codex should work in. Defaults to the managed workspace root.' },
        model: { type: 'string', description: 'Optional Codex model id, e.g. gpt-5-codex. Uses the CLI default when omitted.' },
        sandbox: { type: 'string', enum: ['read-only', 'workspace-write', 'danger-full-access'], description: 'Codex sandbox mode. Defaults to workspace-write.' },
        timeoutSeconds: { type: 'number', description: 'Wall-clock budget for the Codex run. Defaults to 600, capped at 3600.' }
      },
      required: ['task']
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          exitCode: { type: 'number' },
          durationMs: { type: 'number' },
          output: { type: 'string' },
          stderr: { type: 'string' },
          timedOut: { type: 'boolean' },
          truncated: { type: 'boolean' }
        },
        additionalProperties: true
      },
      render: (_args, value) => {
        const blocks = [{ type: 'text', text: value?.output?.trim() || '(codex produced no output)' }]
        if (value?.stderr?.trim()) blocks.push({ type: 'text', text: `\n[stderr] ${value.stderr.trim().slice(0, 2000)}` })
        return blocks
      }
    },
    timeoutMs: 3_700_000,
    isConcurrencySafe: (args) => args?.sandbox !== 'danger-full-access',
    async execute (args, exec) {
      const startedAt = Date.now()
      const codexPath = deps.resolvePath()
      if (!codexPath) throw new Error('codex.exe not found — set its path in the LocalCodingMCP settings first')

      const provider = await ensureReady(codexPath)

      const workspace = args?.workspace || deps.workspaceRoot
      if (!existsSync(workspace)) throw new Error(`workspace directory does not exist: ${workspace}`)

      // Fail in seconds instead of burning the whole budget: an unreachable
      // endpoint makes `codex exec` retry silently until it is killed.
      const endpoint = await probeEndpoint(provider)
      if (endpoint.checked && endpoint.reachable === false) {
        throw new Error([
          `codex cannot reach its model endpoint ${provider.baseUrl}: ${endpoint.error}`,
          'Codex authenticates here with a bearer token in ~/.codex/config.toml, so `codex login` will not fix this',
          '— check that the relay is up and reachable from this machine.'
        ].join(' '))
      }

      const timeoutSeconds = Math.min(Math.max(Number(args?.timeoutSeconds ?? 600), 5), 3600)
      const cliArgs = ['exec', '--skip-git-repo-check', '--sandbox', args?.sandbox ?? 'workspace-write']
      if (args?.model) cliArgs.push('--model', String(args.model))
      cliArgs.push('--cd', workspace, args.task)

      deps.logger?.info?.(`[localcoding-mcp] codex exec in ${workspace} (${timeoutSeconds}s budget)`)
      const result = await runCodex(codexPath, cliArgs, {
        timeoutMs: timeoutSeconds * 1000,
        cwd: workspace,
        signal: exec?.signal,
        env: process.env,
        stdin: ''
      })
      const value = {
        ok: result.code === 0,
        exitCode: result.code,
        durationMs: Date.now() - startedAt,
        output: result.stdout.slice(0, MAX_CAPTURED_CHARS),
        stderr: result.stderr.slice(0, 20_000),
        timedOut: result.timedOut,
        truncated: result.stdout.length >= MAX_CAPTURED_CHARS
      }
      if (value.timedOut) throw new Error(describeTimeout(value, timeoutSeconds, { ...deps, providerConfig: provider }))
      if (exec?.signal?.aborted) throw new Error('codex exec aborted by the caller')
      if (result.code !== 0) throw new Error(value.stderr.trim().slice(0, 2000) || `codex exec exited with code ${result.code}`)
      return value
    }
  }
}

export { runCodex, DEFAULT_CODEX_PATH }

/**
 * A timeout from `codex exec` is almost never "the task was too hard". Codex
 * retries a dead or unreachable endpoint in the background
 * (`Reconnecting... n/5 (stream disconnected before completion)`) while printing
 * nothing useful to stdout in human-readable mode, so the run looks identical to
 * a hung agent. That marker is only emitted with `--json`, so the fast, reliable
 * signal is the endpoint pre-flight in `probeEndpoint`.
 */
function describeTimeout (value, timeoutSeconds, deps) {
  const streams = `${value.stderr}\n${value.output}`
  const relayProblem = /Reconnecting\.\.\. \d+\/\d+ \(stream disconnected before completion: error sending request for url \(([^)]+)\)/.exec(streams)
  if (relayProblem) {
    return [
      `codex exec exceeded ${timeoutSeconds}s and was killed.`,
      'It was not the task: Codex could not reach its model endpoint',
      `${relayProblem[1]} (\`stream disconnected before completion\`) and spent the whole budget retrying.`
    ].join(' ')
  }
  return `codex exec exceeded ${timeoutSeconds}s and was killed with no output — the model endpoint ${deps?.providerConfig?.baseUrl ?? '(configured base_url)'} may be unreachable, or the turn is still streaming`
}

/**
 * Reachability pre-flight for a relay endpoint.
 *
 * `codex login status` cannot answer this: a config that authenticates with a
 * bearer token instead of an OpenAI login always reports "Not logged in", and
 * the real failure only appears minutes later as a silent hang. A bare TCP/TLS
 * probe to the base_url turns that into a two-second answer. No credentials are
 * attached — a 401 still proves the endpoint is up, which is all we ask.
 */
export async function probeEndpoint (provider, options = {}) {
  const baseUrl = provider?.baseUrl
  if (!baseUrl) return { checked: false }
  let url
  try {
    url = new URL(baseUrl)
  } catch {
    return { checked: false }
  }
  const startedAt = Date.now()
  try {
    await withDeadline(undefined, options.timeoutMs ?? 8000, async (deadline) => {
      await fetch(url, { method: 'GET', signal: deadline, redirect: 'manual' })
    })
    return { checked: true, reachable: true, status: 'ok', durationMs: Date.now() - startedAt }
  } catch (error) {
    return {
      checked: true,
      reachable: false,
      durationMs: Date.now() - startedAt,
      error: error?.message ?? String(error)
    }
  }
}

/**
 * Point the Codex CLI at this app's model endpoint.
 *
 * Codex normally talks to whatever `base_url` its config names — on this machine a
 * third-party relay with its own bearer token. That is the arrangement this
 * replaces: the plugin serves this app's own model access at `/v1`, so Codex can
 * use the same model as the app with no relay and no separate credential.
 *
 * The edit is confined and reversible: the previous `model_provider` and the whole
 * `[model_providers.dsh]` block are what get rewritten, and a timestamped backup of
 * the original file is written first. A tool that silently rewrote a user's CLI
 * configuration with no way back would be unacceptable, so the backup is not
 * optional.
 *
 * @param {string} providerId provider route the `[model_providers.*]` block declares
 * @param {string} baseUrl the `/v1` base url to write
 * @param {{model?: string, codexPath?: string}} [options]
 * @returns {Promise<{configPath: string, backupPath: string, baseUrl: string, provider: string, model?: string, text: string}>}
 */
export async function configureCodexProvider (providerId, baseUrl, options = {}) {
  const configDir = path.join(homedir(), '.codex')
  const configPath = path.join(configDir, 'config.toml')
  let original
  try {
    original = readFileSync(configPath, 'utf8')
  } catch (error) {
    throw new Error(`cannot read ${configPath}: ${error.message}. Run \`codex\` once so it creates its configuration.`)
  }

  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)
  const backupPath = `${configPath}.bak-dsh-model-${stamp}`
  writeFileSync(backupPath, original, 'utf8')

  const block = [
    `[model_providers.${providerId}]`,
    'name = "DSH Harness"',
    `base_url = "${baseUrl}"`,
    'wire_api = "chat"',
    'requires_openai_auth = false'
  ].join('\n')

  // Strip the keys and the table we are about to replace, then re-add them. Doing
  // it textually keeps comments and key order for everything we do not own.
  const withoutProvider = original
    .replace(/^\s*model_provider\s*=.*$/m, '')
    .replace(new RegExp(`^\\[model_providers\\.${providerId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\s*\\n(?:[^\\[\\n].*\\n?)*`, 'm'), '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()

  const parts = [`model_provider = "${providerId}"`]
  if (typeof options.model === 'string' && options.model !== '') parts.push(`model = "${options.model}"`)
  const next = `${parts.join('\n')}\n\n${withoutProvider}\n\n${block}\n`
  writeFileSync(configPath, next, 'utf8')

  return {
    configPath,
    backupPath,
    baseUrl,
    provider: providerId,
    ...(options.model ? { model: options.model } : {}),
    text: [
      `Codex will now use this app's model endpoint.`,
      `  provider   ${providerId}`,
      `  base_url   ${baseUrl}`,
      `  wire_api   chat`,
      `  config     ${configPath}`,
      `  backup     ${backupPath}`,
      'Start a new Codex session for it to take effect. Restore the backup to undo.'
    ].join('\n')
  }
}

/**
 * The newest backup this plugin created for `~/.codex/config.toml`, if any.
 *
 * The naming rule is the contract: only files this module wrote match, so the
 * restore path can never pick up some unrelated `.bak` and clobber the user's
 * configuration with it.
 */
export function latestCodexBackup () {
  const configDir = path.join(homedir(), '.codex')
  let entries
  try {
    entries = readdirSync(configDir)
  } catch {
    return undefined
  }
  const candidates = entries
    .filter((entry) => entry.startsWith('config.toml.bak-dsh-model-'))
    .sort()
  if (candidates.length === 0) return undefined
  return path.join(configDir, candidates.at(-1))
}

/** Undo {@link configureCodexProvider} from a backup file it created. */
export async function restoreCodexConfig (backupPath) {  if (typeof backupPath !== 'string' || backupPath === '') throw new Error('backupPath is required')
  if (!/\.bak-dsh-model-\d+$/.test(backupPath)) {
    throw new Error('refusing to restore from a file this plugin did not create')
  }
  const configPath = path.join(homedir(), '.codex', 'config.toml')
  writeFileSync(configPath, readFileSync(backupPath, 'utf8'), 'utf8')
  return { configPath, restoredFrom: backupPath }
}

function withDeadline (_signal, timeoutMs, fn) {
  const deadline = AbortSignal.timeout(timeoutMs)
  return fn(deadline)
}
