/**
 * LocalCodingMCP as a DSH Harness plugin.
 *
 * The MCP server at `E:\ai\aiassistant\plugins\LocalCodingMCP_v0_3` is a .NET 8
 * process that exposes ~40 coding tools over HTTP. Three directions are wired here,
 * and each is independent:
 *
 *   1. **Bridge (local)** — every MCP tool is registered into the host `tools` service
 *      as `lcm_<tool>`, so the DeepSeek agent drives the workspace through the same
 *      tool surface ChatGPT gets. Names are prefixed because `read_file`,
 *      `write_file`, `search_code` and `apply_patch` would otherwise read as
 *      duplicates of the host's native `read`/`edit`/`grep` family.
 *   2. **Reverse delegation** — `lcm_codex_task` hands a self-contained coding task
 *      to `codex exec`. Once the plugin registers its `/mcp` endpoint with
 *      `codex mcp add --url`, the Codex child calls back into the same server, so the
 *      two agents compose over one tool surface.
 *   3. **GPT web → local** — a signed-in chatgpt.com account cannot reach a
 *      `127.0.0.1` endpoint, so `TunnelFleet` runs one `tunnel-client.exe` per
 *      configured account. Each daemon dials *out* to the OpenAI control plane, and
 *      the connector the user picks at `chatgpt.com/#settings/Connectors` then calls
 *      back through that outbound connection. This is the direction that makes the web
 *      model able to use this machine, and it is the one that needs no inbound port.
 *
 * The plugin owns every process it starts: the coding server, the tunnel daemons and
 * the optional browser MCP, all stopped with the host. Settings live in one Settings
 * section served by `server/http.js`.
 *
 * @module dsh-localcoding-mcp
 */
import z from '@deepseek-ai/schemastery'

import { McpHttpClient } from './server/mcp-client.js'
import { McpServerProcess, probeExistingServer } from './server/process.js'
import { McpToolBridge } from './server/bridge.js'
import {
  buildCodexToolDefinition,
  ensureCodexMcpServer,
  listCodexMcpServers,
  probeCodex,
  probeEndpoint,
  removeCodexMcpServer,
  resolveCodexPath
} from './server/codex.js'
import { DEFAULT_CONTROL_PLANE_BASE_URL, TunnelFleet } from './server/tunnel.js'
import { createBrowserProcess } from './server/browser.js'
import { registerRoutes } from './server/http.js'

/** Stable Cordis plugin name (also the id used in the Desktop patch row). */
export const name = 'dsh-localcoding-mcp'

/**
 * Only `tools` is a hard dependency. The HTTP plane is optional so the tools
 * still mount in a profile without a web server; `logger` comes from the base
 * context and needs no declaration.
 */
export const inject = ['tools']

/**
 * Settings namespace. Since host 0.1.7 a Settings section *is* the owning Loader
 * entry and upstream keys its form by the entry id, so this must stay equal to
 * the patch row id or the page has no form at all.
 */
export const SETTINGS_NAMESPACE = name

/** MCP server name registered with the Codex CLI. */
export const CODEX_SERVER_NAME = 'dsh-localcoding'

export { McpHttpClient } from './server/mcp-client.js'
export { McpServerProcess, probeExistingServer, findFreePort } from './server/process.js'
export { McpToolBridge, buildToolDefinition, buildParameters, PREFIX } from './server/bridge.js'
export { resolveCodexPath, probeCodex, ensureCodexMcpServer, removeCodexMcpServer, listCodexMcpServers } from './server/codex.js'
export { TunnelFleet, readAccounts, keyVariableName, decryptControlPlaneKey, probeProxy, resolveProxy } from './server/tunnel.js'
export { BrowserMcpProcess, createBrowserProcess, resolveExtensionToken, DEFAULT_BROWSER_ENTRY } from './server/browser.js'

const DEFAULT_EXE = 'E:\\ai\\aiassistant\\plugins\\LocalCodingMCP_v0_3\\mcp-accounts\\bin\\Release\\net8.0\\win-x64\\LocalCodingMCP.exe'

/** Root of the LocalCodingMCP project; the tunnel and browser assets live below it. */
const PROJECT_ROOT = 'E:\\ai\\aiassistant\\plugins\\LocalCodingMCP_v0_3\\mcp-accounts'

/**
 * Everything the Settings page can change.
 *
 * `workspaceRoot` is the directory the server is allowed to touch — it becomes
 * `--root`, so it is the security boundary of the whole bridge. `port` is only a
 * preference: the manager walks upward when the port is taken so a stale process
 * cannot silently hijack the URL the agent is configured against.
 *
 * The `tunnel*` block configures the GPT-web direction. `tunnelAccountsPath` and
 * `tunnelExePath` point at assets the LocalCodingMCP project already owns; control
 * plane keys are never part of this config, because they live DPAPI-encrypted in the
 * project's `accounts.json` and are decrypted in memory only.
 */
export const Config = z.object({
  workspaceRoot: z.string().default('E:\\ai\\dsh-plugins'),
  exePath: z.string().default(DEFAULT_EXE),
  port: z.number().default(3011),
  autoStart: z.boolean().default(true),
  authToken: z.string().default(''),
  toolTimeoutSeconds: z.number().default(300),
  autoRegisterWithCodex: z.boolean().default(false),
  codexPath: z.string().default(''),
  codexModel: z.string().default(''),

  // ---- GPT web → local ----
  /** Master switch for the tunnel fleet; no daemon starts while it is off. */
  tunnelEnabled: z.boolean().default(false),
  tunnelExePath: z.string().default(`${PROJECT_ROOT}\\tunnel-client.exe`),
  tunnelAccountsPath: z.string().default(`${PROJECT_ROOT}\\config\\accounts.json`),
  tunnelProfileDir: z.string().default(`${PROJECT_ROOT}\\secrets\\tunnel-profiles`),
  tunnelLogDir: z.string().default(`${PROJECT_ROOT}\\logs`),
  tunnelHealthPortBase: z.number().default(8080),
  tunnelReadyTimeoutSeconds: z.number().default(45),
  tunnelProxy: z.string().default(''),
  tunnelControlPlaneBaseUrl: z.string().default(DEFAULT_CONTROL_PLANE_BASE_URL),
  /** Start every configured account when the plugin loads. */
  tunnelAutoStartAll: z.boolean().default(false),

  // ---- optional browser surface ----
  browserEnabled: z.boolean().default(false),
  browserEntry: z.string().default(''),
  browserPort: z.number().default(8931),
  browserAutoStart: z.boolean().default(false)
})

/**
 * Build the controller the HTTP routes drive. It reads through a mutable holder
 * because the effect that owns the process re-runs whenever a setting changes;
 * routes stay mounted and keep talking to whatever is live.
 */
function createController (ctx, config, holder) {
  const logger = ctx.logger
  const codexPathOf = () => resolveCodexPath(config.codexPath)

  return {
    /** Full snapshot rendered by the page header. */
    async status () {
      const live = holder.current
      const codex = await probeCodex(codexPathOf(), { timeoutMs: 8_000 })
      const tunnel = holder.tunnel
      const browser = holder.browser
      // One `codex mcp list` feeds both facts the page needs: whether our row exists
      // at all, and whether it still points at the port we answer on. The name alone
      // is not enough — a stale row from an earlier session reads as "registered"
      // while Codex calls a port nothing is listening on.
      const codexServers = await listCodexMcpServers(codexPathOf())
      const codexRow = codexServers.find((entry) => entry.name === CODEX_SERVER_NAME)
      const codexUrl = live?.process.mcpUrl
      return {
        settings: {
          workspaceRoot: config.workspaceRoot,
          exePath: config.exePath,
          port: config.port,
          autoStart: config.autoStart,
          authRequired: config.authToken.length > 0,
          toolTimeoutSeconds: config.toolTimeoutSeconds,
          autoRegisterWithCodex: config.autoRegisterWithCodex,
          codexPath: config.codexPath,
          codexModel: config.codexModel,
          tunnelEnabled: config.tunnelEnabled,
          browserEnabled: config.browserEnabled
        },
        server: live ? live.process.describe() : { state: 'disabled' },
        tools: live ? live.bridge.describe() : { toolCount: 0, tools: [] },
        client: live
          ? {
              connected: live.client.connected,
              sessionId: live.client.sessionId,
              serverInfo: live.client.serverInfo,
              capabilities: live.client.capabilities
            }
          : { connected: false },
        codex: {
          path: codexPathOf(),
          ...codex,
          // The real readiness signal: `login status` cannot tell us whether the
          // configured relay answers, and an unreachable one looks like a hang.
          endpoint: await probeEndpoint(codex?.provider),
          mcpServerName: CODEX_SERVER_NAME,
          mcpUrl: codexUrl,
          registered: codexRow !== undefined,
          // A row pointing somewhere else is the failure a boolean hides.
          registeredUrl: codexRow?.url,
          matchesOurEndpoint: codexRow !== undefined && codexUrl !== undefined && codexRow.url === codexUrl,
          servers: codexServers
        },
        // The GPT-web direction. `enabled:false` is reported rather than hidden so
        // the page can explain why no account is listed instead of showing nothing.
        tunnel: tunnel
          ? { enabled: true, ...tunnel.describe() }
          : { enabled: false, reason: 'tunnel fleet is disabled in settings', accounts: [] },
        browser: browser
          ? { enabled: true, ...browser.describe() }
          : { enabled: false, reason: 'browser tools are disabled in settings', state: 'disabled' }
      }
    },

    /** Live process health, cheap enough to poll. */
    async health () {
      return holder.current ? holder.current.process.health() : { status: 'disabled' }
    },

    /** Tools currently registered in the host. */
    tools () {
      return holder.current ? holder.current.bridge.describe() : { toolCount: 0, tools: [] }
    },

    /** Recent server output for the diagnostics panel. */
    logs (limit) {
      const entries = holder.current?.process.logs ?? []
      return entries.slice(-Math.min(Math.max(limit, 1), 200))
    },

    /** Handshake facts plus the head of the server's own instructions. */
    async probe () {
      const live = holder.current
      if (!live) return { ok: false, error: 'server not configured' }
      try {
        await live.client.ensureSession()
        return {
          ok: true,
          sessionId: live.client.sessionId,
          serverInfo: live.client.serverInfo,
          capabilities: live.client.capabilities,
          instructions: String(live.client.instructions ?? '').slice(0, 4000)
        }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },

    /** Tool list straight from the MCP server, registered or not. */
    async availableTools () {
      const live = holder.current
      if (!live) return { ok: false, error: 'server not configured', tools: [] }
      try {
        const tools = await live.client.listTools()
        return {
          ok: true,
          count: tools.length,
          tools: tools.map((tool) => ({
            name: tool.name,
            description: String(tool.description ?? '').slice(0, 400),
            parameters: tool.inputSchema ?? null
          }))
        }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error), tools: [] }
      }
    },

    async start () {
      const live = holder.current
      if (!live) throw new Error('server not configured')
      live.client.reset()
      return live.process.start()
    },

    async stop () {
      const live = holder.current
      if (!live) throw new Error('server not configured')
      live.bridge.dispose()
      live.client.reset()
      await live.process.stop()
      return live.process.describe()
    },

    async restart () {
      const live = holder.current
      if (!live) throw new Error('server not configured')
      await live.process.restart()
      live.client.reset()
      return live.process.describe()
    },

    /** Re-list tools and re-register; also recovers a dropped session. */
    async refreshTools () {
      const live = holder.current
      if (!live) throw new Error('server not configured')
      live.bridge.dispose()
      live.client.reset()
      await live.process.start()
      return live.bridge.sync()
    },

    /** Call one MCP tool directly, so the page can prove the wiring without a chat turn. */
    async callTool (toolName, args) {
      const live = holder.current
      if (!live) throw new Error('server not configured')
      const startedAt = Date.now()
      const result = await live.client.callTool(toolName, args)
      return {
        tool: toolName,
        ok: result.isError !== true,
        durationMs: Date.now() - startedAt,
        text: result.text,
        isError: result.isError === true
      }
    },

    /** `codex mcp add dsh-localcoding --url <our /mcp>` so Codex can call us back. */
    async registerWithCodex () {
      const live = holder.current
      if (!live) throw new Error('server not configured')
      if (!(await probeExistingServer(live.process.healthUrl))) await live.process.start()
      const codexPath = codexPathOf()
      const result = await ensureCodexMcpServer(codexPath, CODEX_SERVER_NAME, live.process.mcpUrl)
      logger?.info?.(`[localcoding-mcp] registered ${result.name} -> ${result.url} with codex`)
      return { ...result, toolCount: live.bridge.describe().toolCount }
    },

    async unregisterFromCodex () {
      return removeCodexMcpServer(codexPathOf(), CODEX_SERVER_NAME)
    },

    // ---- GPT web → local ----

    /**
     * Accounts from `accounts.json` plus whatever the fleet currently holds.
     *
     * Same shape as the `status` tunnel section — the page treats "enabled but empty"
     * and "disabled" as different messages, so both routes have to agree on which one
     * they are reporting.
     */
    tunnelDescribe () {
      const tunnel = holder.tunnel
      return tunnel
        ? { enabled: true, ...tunnel.describe() }
        : { enabled: false, reason: 'tunnel fleet is disabled in settings', accounts: [], skipped: [] }
    },

    async tunnelProbe (accountId) {
      const tunnel = requireTunnel(holder)
      return tunnel.probe(accountId)
    },

    async tunnelDoctor (accountId) {
      const tunnel = requireTunnel(holder)
      return tunnel.doctor(accountId)
    },

    async tunnelStart (accountId) {
      const tunnel = requireTunnel(holder)
      // The tunnel forwards to whatever /mcp the coding server currently answers on,
      // so an adopted or relocated server must be reflected before a daemon starts.
      await syncTunnelTarget(holder, config, logger)
      return tunnel.start(accountId)
    },

    async tunnelStartAll () {
      const tunnel = requireTunnel(holder)
      await syncTunnelTarget(holder, config, logger)
      return tunnel.startAll()
    },

    async tunnelStop (accountId) {
      return requireTunnel(holder).stop(accountId)
    },

    async tunnelStopAll () {
      return requireTunnel(holder).stopAll()
    },

    browserDescribe () {
      const browser = holder.browser
      return browser
        ? { enabled: true, ...browser.describe() }
        : { enabled: false, reason: 'browser tools are disabled in settings', state: 'disabled' }
    },

    async browserStart () {
      const browser = holder.browser
      if (!browser) throw new Error('browser tools are disabled in settings')
      return browser.start()
    },

    async browserStop () {
      const browser = holder.browser
      if (!browser) throw new Error('browser tools are disabled in settings')
      return browser.stop()
    }
  }
}

/** A tunnel action is only meaningful once the fleet exists. */
function requireTunnel (holder) {
  const tunnel = holder.tunnel
  if (!tunnel) throw new Error('tunnel fleet is disabled in settings — enable it first')
  return tunnel
}

/**
 * Point the fleet at the port the coding server actually ended up on.
 *
 * The tunnel forwards to a literal URL, so a server that adopted an existing process
 * or walked to the next free port would otherwise be advertised with the stale port
 * from the previous configuration.
 */
async function syncTunnelTarget (holder, config, logger) {
  const tunnel = holder.tunnel
  const live = holder.current
  if (!tunnel || !live) return
  const target = live.process.mcpUrl
  if (tunnel.mcpUrl === target) return
  tunnel.mcpUrl = target
  logger?.info?.(`[localcoding-mcp/tunnel] target updated to ${target}`)
}

/**
 * Wire the plugin.
 *
 * @param ctx - Host context carrying the `tools` service (plus `webServer` when
 *   the HTTP plane is mounted).
 * @param config - This plugin's resolved `Config`, supplied by the Loader.
 */
export function apply (ctx, config) {
  const holder = { current: undefined, tunnel: undefined, browser: undefined }

  // Settings routes are independent of the process lifetime: the page has to
  // render while the server is stopped, which is exactly when it is useful.
  ctx.inject(['webServer'], (webCtx) =>
    webCtx.effect(() => registerRoutes(webCtx, createController(ctx, config, holder)), 'dsh-localcoding-mcp: settings routes')
  )

  ctx.effect(async () => {
    // Reading every field here is what makes this effect re-run when the user
    // edits settings: Cordis tracks the config reads performed synchronously.
    const workspaceRoot = String(config.workspaceRoot ?? '')
    const exePath = String(config.exePath ?? '')
    const preferredPort = Number(config.port ?? 3011)
    const autoStart = config.autoStart !== false
    const authToken = String(config.authToken ?? '')
    const toolTimeoutMs = Math.max(1, Number(config.toolTimeoutSeconds ?? 300)) * 1000
    const codexPath = resolveCodexPath(config.codexPath)
    const codexModel = String(config.codexModel ?? '')
    const autoRegisterWithCodex = config.autoRegisterWithCodex === true

    const tunnelEnabled = config.tunnelEnabled === true
    const browserEnabled = config.browserEnabled === true
    const tunnelAutoStartAll = config.tunnelAutoStartAll === true
    const browserAutoStart = config.browserAutoStart === true
    const tunnelOptions = {
      exePath: String(config.tunnelExePath ?? ''),
      accountsPath: String(config.tunnelAccountsPath ?? ''),
      profileDir: String(config.tunnelProfileDir ?? ''),
      logDir: String(config.tunnelLogDir ?? ''),
      controlPlaneBaseUrl: String(config.tunnelControlPlaneBaseUrl ?? DEFAULT_CONTROL_PLANE_BASE_URL),
      healthPortBase: Math.max(1024, Number(config.tunnelHealthPortBase ?? 8080)),
      readyTimeoutSeconds: Math.max(5, Number(config.tunnelReadyTimeoutSeconds ?? 45)),
      proxy: String(config.tunnelProxy ?? ''),
      logger: ctx.logger
    }
    const browserOptions = {
      entry: String(config.browserEntry ?? ''),
      port: Math.max(1024, Number(config.browserPort ?? 8931)),
      autoStart: browserAutoStart,
      logger: ctx.logger
    }

    const process_ = new McpServerProcess({
      exePath,
      workspaceRoot,
      port: preferredPort,
      autoStart,
      ...authToken ? { authToken } : {},
      logger: ctx.logger
    })
    const client = new McpHttpClient(
      `http://127.0.0.1:${preferredPort}/mcp`,
      { headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} }
    )
    const bridge = new McpToolBridge({
      tools: ctx.tools,
      client,
      serverUrl: client.endpoint,
      timeoutMs: toolTimeoutMs,
      logger: ctx.logger
    })

    const live = { process: process_, client, bridge }
    holder.current = live
    ctx.logger?.info?.(`[localcoding-mcp] workspace=${workspaceRoot} exe=${exePath} port=${preferredPort} autoStart=${autoStart}`)

    try {
      await process_.start()
      // Adopt the port the manager actually settled on (it may differ from the
      // preference) before the client and the Codex tool point at it.
      client.endpoint = process_.mcpUrl
      bridge.serverUrl = process_.mcpUrl
      await bridge.sync()
    } catch (error) {
      // A server that cannot start must not stop the plugin from loading: the
      // Settings page exists precisely to fix this.
      ctx.logger?.warn?.(error instanceof Error ? error : new Error(String(error)))
    }

    const disposeCodex = ctx.tools.register(buildCodexToolDefinition({
      mcpUrl: process_.mcpUrl,
      workspaceRoot,
      resolvePath: () => resolveCodexPath(config.codexPath),
      logger: ctx.logger,
      defaultModel: codexModel || undefined
    }))

    // Registering with Codex is opt-in: it rewrites `~/.codex/config.toml`, which
    // is the user's own CLI configuration, not this plugin's.
    if (autoRegisterWithCodex && codexPath && process_.state !== 'stopped') {
      try {
        const result = await ensureCodexMcpServer(codexPath, CODEX_SERVER_NAME, process_.mcpUrl)
        ctx.logger?.info?.(`[localcoding-mcp] codex MCP server ${result.name} -> ${result.url}`)
      } catch (error) {
        ctx.logger?.warn?.(error instanceof Error ? error : new Error(String(error)))
      }
    }

    // ---- GPT web → local ----
    //
    // The fleet is only built when enabled, and it is bound to the URL the coding
    // server really answers on. Starting daemons is opt-in on top of that: each one
    // opens an outbound connection to the OpenAI control plane with a real
    // credential, so `tunnelAutoStartAll` is off by default and the page drives it.
    let fleet
    if (tunnelEnabled) {
      fleet = new TunnelFleet({ ...tunnelOptions, mcpUrl: process_.mcpUrl })
      holder.tunnel = fleet
      if (tunnelAutoStartAll && process_.state !== 'stopped') {
        try {
          const { results } = await fleet.startAll()
          const ready = results.filter((entry) => entry.state === 'READY').length
          ctx.logger?.info?.(`[localcoding-mcp/tunnel] ${ready}/${results.length} account tunnel(s) ready`)
        } catch (error) {
          ctx.logger?.warn?.(error instanceof Error ? error : new Error(String(error)))
        }
      }
    }

    // ---- optional browser surface ----
    //
    // Independent of the tunnel on purpose: the tunnel publishes exactly one MCP
    // server URL, so exposing the browser to ChatGPT means pointing a second
    // connector at it. Starting it here when enabled keeps the page simple.
    let browser
    if (browserEnabled) {
      browser = createBrowserProcess(browserOptions)
      holder.browser = browser
      if (browserAutoStart) {
        try {
          await browser.start()
        } catch (error) {
          ctx.logger?.warn?.(error instanceof Error ? error : new Error(String(error)))
        }
      }
    }

    return () => {
      try {
        disposeCodex()
      } catch { /* registry teardown must not mask the rest */ }
      bridge.dispose()
      holder.current = undefined
      // Stop every daemon we started. `dispose()` never throws, so one stubborn
      // child cannot keep the rest alive.
      void Promise.all([
        client.close().finally(() => process_.dispose()),
        fleet?.dispose(),
        browser?.dispose()
      ])
      holder.tunnel = undefined
      holder.browser = undefined
    }
  }, 'dsh-localcoding-mcp: bridge')
}
