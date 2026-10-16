/**
 * LocalCodingMCP as a DSH Harness plugin — native tools, not a spawned server.
 *
 * This plugin used to start `LocalCodingMCP.exe` and bridge its HTTP tools. It no
 * longer does. The tool surface is implemented in this repo (`server/native/`) and
 * registered straight into the host's `tools` service, which removes a child
 * process, a port, a health check and a build step from the path between the agent
 * and its tools.
 *
 * Four things are wired here, and they share one tool table:
 *
 *   1. **Native tools** — every file, search, git, build, process and undo tool is a
 *      plain `ToolDefinition` from `server/native/index.js`.
 *   2. **An MCP endpoint of our own** (`server/mcp-server.js`) serving exactly those
 *      tools over streamable HTTP at `/mcp`. This is what `codex mcp add --url`
 *      points at, and what the tunnel publishes to ChatGPT.
 *   3. **A model endpoint** (`server/model-routes.js`) exposing this app's own model
 *      access in OpenAI's dialect at `/v1`, so Codex runs on the same model as this
 *      app instead of a third-party relay.
 *   4. **The GPT-web tunnel** (`server/tunnel.js`) — one `tunnel-client.exe` per
 *      ChatGPT account, dialing out so no inbound port is needed.
 *
 * `sourceMode: 'external-mcp'` still exists for anyone who wants to attach to a
 * `LocalCodingMCP.exe` someone else started. It only ever *connects*; nothing in
 * this plugin spawns that binary.
 *
 * @module dsh-localcoding-mcp
 */
import { Buffer } from 'node:buffer'

import z from '@deepseek-ai/schemastery'

import { McpHttpClient } from './server/mcp-client.js'
import { probeExistingServer } from './server/process.js'
import { McpToolBridge } from './server/bridge.js'
import {
  buildCodexToolDefinition,
  configureCodexProvider,
  ensureCodexMcpServer,
  latestCodexBackup,
  listCodexMcpServers,
  probeCodex,
  probeEndpoint,
  removeCodexMcpServer,
  resolveCodexPath,
  restoreCodexConfig
} from './server/codex.js'
import { createNativeSurface } from './server/native/index.js'
import { createMcpEndpoint } from './server/mcp-server.js'
import { MODEL_BASE_PATH, modelBaseUrl, registerModelRoutes } from './server/model-routes.js'
import { DEFAULT_CONTROL_PLANE_BASE_URL, TunnelFleet } from './server/tunnel.js'
import { createBrowserProcess } from './server/browser.js'
import { registerRoutes } from './server/http.js'

/** Stable Cordis plugin name (also the id used in the Desktop patch row). */
export const name = 'dsh-localcoding-mcp'

/** Only `tools` is a hard dependency; the HTTP plane is optional by design. */
export const inject = ['tools']

/** Settings namespace; must equal the patch row id or the page has no form. */
export const SETTINGS_NAMESPACE = name

/** MCP server name registered with the Codex CLI. */
export const CODEX_SERVER_NAME = 'dsh-localcoding'

export { McpHttpClient } from './server/mcp-client.js'
export { McpServerProcess, probeExistingServer, findFreePort } from './server/process.js'
export { McpToolBridge, buildToolDefinition, buildParameters, PREFIX } from './server/bridge.js'
export { resolveCodexPath, probeCodex, ensureCodexMcpServer, removeCodexMcpServer, listCodexMcpServers } from './server/codex.js'
export { TunnelFleet, readAccounts, keyVariableName, decryptControlPlaneKey, probeProxy, resolveProxy } from './server/tunnel.js'
export { BrowserMcpProcess, createBrowserProcess, resolveExtensionToken, DEFAULT_BROWSER_ENTRY } from './server/browser.js'
export { createNativeSurface } from './server/native/index.js'
export { createMcpEndpoint } from './server/mcp-server.js'
export { registerModelRoutes, MODEL_BASE_PATH, modelBaseUrl } from './server/model-routes.js'

/** Root of the LocalCodingMCP project; the tunnel and browser assets live below it. */
const PROJECT_ROOT = 'E:\\ai\\aiassistant\\plugins\\LocalCodingMCP_v0_3\\mcp-accounts'

/**
 * Everything the Settings page can change.
 *
 * `workspaceRoot` is the security boundary: every native tool resolves its paths
 * inside it and refuses anything that escapes, which matters because the MCP
 * endpoint is reachable by a ChatGPT connector.
 *
 * `sourceMode` defaults to `native`. The `external-mcp` block exists so an
 * already-running `LocalCodingMCP.exe` can still be attached to; nothing here
 * spawns it.
 *
 * The `model*` block points Codex at this app's own model. `modelProvider` and
 * `modelId` are blank by default, which means "use whatever this app is already
 * routed to" — hardcoding a pair here would pin Codex to a model the app may not
 * have.
 */
export const Config = z.object({
  workspaceRoot: z.string().default('E:\\ai\\dsh-plugins'),
  /**
   * The address clients are told to use for this plugin's endpoints.
   *
   * A route handler never needs to know its own origin, but Codex's config and the
   * tunnel both need an absolute URL, so it is configuration with the app's
   * conventional loopback address as the default. Override it if the GUI is reached
   * on a different port.
   */
  publicBaseUrl: z.string().default('http://127.0.0.1:19387'),
  /**
   * `native` implements the tools here; `external-mcp` attaches to a running server.
   *
   * A plain string rather than `z.enum`: schemastery has no `enum`, and the value is
   * validated where it is used anyway, so an unexpected string degrades to `native`
   * instead of failing to load the plugin.
   */
  sourceMode: z.string().default('native'),
  toolTimeoutSeconds: z.number().default(300),
  autoRegisterWithCodex: z.boolean().default(false),
  codexPath: z.string().default(''),
  codexModel: z.string().default(''),

  // ---- attach-only mode (never spawns) ----
  externalMcpUrl: z.string().default('http://127.0.0.1:3011/mcp'),
  externalMcpAuthToken: z.string().default(''),

  // ---- this app's model, spoken in OpenAI's dialect ----
  /** Serve `/v1` so Codex can use this app's model instead of its own relay. */
  modelBridgeEnabled: z.boolean().default(true),
  modelProvider: z.string().default(''),
  modelId: z.string().default(''),
  reasoningEffort: z.string().default(''),

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
 * Build the controller the HTTP routes drive.
 *
 * It reads through a mutable holder because the effect that owns the tool surface
 * re-runs whenever a setting changes, while the routes stay mounted and keep
 * talking to whatever is live.
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
      // at all, and whether it still points at the endpoint we answer on. The name
      // alone is not enough — a stale row from an earlier session reads as
      // "registered" while Codex calls a port nothing is listening on.
      const codexServers = await listCodexMcpServers(codexPathOf())
      const codexRow = codexServers.find((entry) => entry.name === CODEX_SERVER_NAME)
      const codexUrl = holder.mcpUrl
      return {
        settings: {
          workspaceRoot: config.workspaceRoot,
          sourceMode: config.sourceMode,
          toolTimeoutSeconds: config.toolTimeoutSeconds,
          autoRegisterWithCodex: config.autoRegisterWithCodex,
          codexPath: config.codexPath,
          codexModel: config.codexModel,
          externalMcpUrl: config.externalMcpUrl,
          modelBridgeEnabled: config.modelBridgeEnabled,
          modelProvider: config.modelProvider,
          modelId: config.modelId,
          reasoningEffort: config.reasoningEffort,
          tunnelEnabled: config.tunnelEnabled,
          browserEnabled: config.browserEnabled
        },
        // Shaped like the old process description so the page and the tests read the
        // same fields, even though nothing is spawned any more.
        server: live
          ? {
              mode: config.sourceMode,
              state: config.sourceMode === 'native' ? 'native' : 'external',
              owned: false,
              toolCount: live.describe().toolCount,
              mcpUrl: holder.mcpUrl,
              modelUrl: holder.modelUrl,
              workspaceRoot: config.workspaceRoot
            }
          : { state: 'disabled' },
        tools: live ? live.describe() : { toolCount: 0, tools: [], failed: [] },
        client: {
          mode: config.sourceMode,
          mcpUrl: holder.mcpUrl,
          modelUrl: holder.modelUrl,
          modelBaseUrl: holder.modelUrl,
          sessions: holder.mcpEndpoint?.sessionCount ?? 0
        },
        codex: {
          path: codexPathOf(),
          ...codex,
          // The real readiness signal when a relay is in play: `login status` cannot
          // tell us whether the configured endpoint answers.
          endpoint: await probeEndpoint(codex?.provider),
          mcpServerName: CODEX_SERVER_NAME,
          mcpUrl: codexUrl,
          registered: codexRow !== undefined,
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

    /** Live health, cheap enough to poll. */
    async health () {
      const live = holder.current
      if (!live) return { status: 'disabled' }
      return {
        status: 'ok',
        mode: config.sourceMode,
        toolCount: live.describe().toolCount,
        mcpUrl: holder.mcpUrl
      }
    },

    /** Tools currently registered in the host. */
    tools () {
      return holder.current ? holder.current.describe() : { toolCount: 0, tools: [], failed: [] }
    },

    /** What the endpoints are, and where a client should point. */
    endpoints () {
      const settings = holder.current ? { workspaceRoot: config.workspaceRoot, sourceMode: config.sourceMode } : {}
      return {
        mcpUrl: holder.mcpUrl,
        modelBaseUrl: holder.modelUrl,
        modelEnabled: config.modelBridgeEnabled === true && holder.live?.llm === true,
        ...settings,
        codexSnippet: holder.mcpUrl === undefined
          ? undefined
          : [
              '# ~/.codex/config.toml',
              '[mcp_servers.dsh-localcoding]',
              `url = "${holder.mcpUrl}"`
            ].join('\n'),
        modelSnippet: holder.modelUrl === undefined
          ? undefined
          : [
              '# point Codex at this app\'s model instead of a relay',
              'model_provider = "dsh"',
              '',
              '[model_providers.dsh]',
              'name = "DSH Harness"',
              `base_url = "${holder.modelUrl}"`,
              'wire_api = "chat"',
              'requires_openai_auth = false'
            ].join('\n')
      }
    },

    /** No process logs any more; kept so the page's diagnostics panel still works. */
    logs () {
      return []
    },

    /** Handshake facts for the page, now about our own endpoint. */
    async probe () {
      const live = holder.current
      if (!live) return { ok: false, error: 'no tool surface is mounted' }
      const definitions = live.definitions ?? []
      return {
        ok: true,
        sessionId: undefined,
        serverInfo: { name: name, version: '0.2.0' },
        capabilities: { tools: { listChanged: true } },
        instructions: [
          `${definitions.length} native tools are registered in the host.`,
          `MCP endpoint: ${holder.mcpUrl ?? '(not mounted)'}`,
          `Model endpoint: ${holder.modelUrl ?? '(disabled)'}`,
          'No child process is involved: the tools run in the plugin process.'
        ].join('\n')
      }
    },

    /** The tool list as an MCP client would see it. */
    async availableTools () {
      const live = holder.current
      if (!live) return { ok: false, error: 'no tool surface is mounted', tools: [] }
      return {
        ok: true,
        count: live.definitions.length,
        tools: live.definitions.map((definition) => ({
          name: definition.name,
          description: String(definition.description ?? '').slice(0, 400),
          parameters: definition.parameters ?? null
        }))
      }
    },

    /**
     * Run one tool the way a remote MCP caller would.
     *
     * Rejections are returned as `ok:false` rather than thrown, because the caller
     * here is the settings page's console, which has to show the failure.
     */
    async callTool (toolName, args) {
      const live = holder.current
      if (!live) throw new Error('no tool surface is mounted')
      const startedAt = Date.now()
      try {
        const content = await live.invoke(toolName, args)
        return { tool: toolName, ok: true, durationMs: Date.now() - startedAt, text: content.map((block) => block.text ?? '').join('\n') }
      } catch (error) {
        return {
          tool: toolName,
          ok: false,
          isError: true,
          durationMs: Date.now() - startedAt,
          text: error instanceof Error ? error.message : String(error)
        }
      }
    },

    /** Rewrite the Codex MCP row to point at our endpoint. Opt-in by design. */
    async registerWithCodex () {
      if (holder.mcpUrl === undefined) throw new Error('the MCP endpoint is not mounted, so there is nothing to register')
      const codexPath = codexPathOf()
      const result = await ensureCodexMcpServer(codexPath, CODEX_SERVER_NAME, holder.mcpUrl)
      logger?.info?.(`[localcoding-mcp] registered ${result.name} -> ${result.url} with codex`)
      return { ...result, toolCount: holder.current?.describe().toolCount ?? 0 }
    },

    async unregisterFromCodex () {
      const result = await removeCodexMcpServer(codexPathOf(), CODEX_SERVER_NAME)
      logger?.info?.(`[localcoding-mcp] removed ${CODEX_SERVER_NAME} from codex`)
      return result
    },

    /**
     * Point Codex at this app's own model endpoint.
     *
     * This is the replacement for a third-party relay: the plugin already serves
     * this app's model access at `/v1`, so the only thing missing was telling Codex
     * about it. A backup of the user's config is written first.
     */
    async useAppModel () {
      if (holder.modelUrl === undefined) throw new Error('the model endpoint is not mounted, so there is nothing to point Codex at')
      const result = await configureCodexProvider('dsh', holder.modelUrl, {
        model: config.codexModel || undefined
      })
      logger?.info?.(`[localcoding-mcp] codex now uses ${holder.modelUrl} (backup ${result.backupPath})`)
      return result
    },

    async restoreCodexConfig (backupPath) {
      return restoreCodexConfig(backupPath)
    },

    /** Undo `useAppModel` using the newest backup this plugin created. */
    async undoUseAppModel () {
      const latest = latestCodexBackup()
      if (latest === undefined) throw new Error('no backup from this plugin was found, so there is nothing to restore')
      const result = await restoreCodexConfig(latest)
      logger?.info?.(`[localcoding-mcp] restored codex config from ${latest}`)
      return result
    },

    // ---- GPT web → local ----

    tunnelDescribe () {
      const tunnel = holder.tunnel
      return tunnel
        ? { enabled: true, ...tunnel.describe() }
        : { enabled: false, reason: 'tunnel fleet is disabled in settings', accounts: [], skipped: [] }
    },

    async tunnelProbe (id) {
      if (!holder.tunnel) throw new Error('tunnel fleet is disabled in settings')
      return holder.tunnel.probe(id)
    },

    async tunnelDoctor (id) {
      if (!holder.tunnel) throw new Error('tunnel fleet is disabled in settings')
      return holder.tunnel.doctor(id)
    },

    async tunnelStart (id) {
      if (!holder.tunnel) throw new Error('tunnel fleet is disabled in settings')
      holder.tunnel.mcpUrl = holder.mcpUrl
      return holder.tunnel.start(id)
    },

    async tunnelStartAll () {
      if (!holder.tunnel) throw new Error('tunnel fleet is disabled in settings')
      holder.tunnel.mcpUrl = holder.mcpUrl
      return holder.tunnel.startAll()
    },

    async tunnelStop (id) {
      if (!holder.tunnel) throw new Error('tunnel fleet is disabled in settings')
      return holder.tunnel.stop(id)
    },

    async tunnelStopAll () {
      if (!holder.tunnel) throw new Error('tunnel fleet is disabled in settings')
      return holder.tunnel.stopAll()
    },

    browserDescribe () {
      const browser = holder.browser
      return browser
        ? { enabled: true, ...browser.describe() }
        : { enabled: false, reason: 'browser tools are disabled in settings', state: 'disabled' }
    },

    async browserStart () {
      if (!holder.browser) throw new Error('browser tools are disabled in settings')
      return holder.browser.start()
    },

    async browserStop () {
      if (!holder.browser) throw new Error('browser tools are disabled in settings')
      return holder.browser.stop()
    }
  }
}

/**
 * The plugin entry point.
 *
 * The tool surface lives in one Cordis effect, so editing any setting tears the
 * surface down and rebuilds it — which is what makes a settings change take effect
 * without a restart for the parts that do not need one.
 */
export function apply (ctx, config) {
  const holder = { current: undefined, tunnel: undefined, browser: undefined, mcpUrl: undefined, modelUrl: undefined, mcpEndpoint: undefined, live: {} }

  const controller = createController(ctx, config, holder)

  // Routes are mounted on the optional web plane; without it the agent still gets
  // every native tool, which is the part that matters.
  //
  // The MCP endpoint is created here, not in the tool-surface effect below, because
  // a route handler needs a real Cordis context (`webCtx.effect`, `webCtx.webServer`)
  // — `ctx.get('webServer')` returns the bare service, which has neither. The two
  // effects are independent and bind late through `holder`, so neither depends on
  // the other's ordering.
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => registerRoutes(webCtx, controller), 'dsh-localcoding-mcp: settings routes')

    if (config.modelBridgeEnabled !== false) {
      const disposeModel = registerModelRoutes(webCtx, {
        llmProvider: () => ctx.get('llm'),
        configProvider: () => ({
          modelProvider: config.modelProvider,
          modelId: config.modelId,
          reasoningEffort: config.reasoningEffort
        })
      })
      webCtx.effect(() => disposeModel, 'dsh-localcoding-mcp: model routes')
    }

    // The MCP endpoint serves exactly the tools the local agent gets, so a remote
    // caller (Codex, or ChatGPT through the tunnel) sees one surface, not a copy.
    const mcpEndpoint = createMcpEndpoint({
      name,
      version: '0.2.0',
      workspace: config.workspaceRoot,
      instructions: 'Tools for reading, editing, searching and building the workspace this harness is rooted in. Paths are relative to that workspace root.',
      listDefinitions: () => holder.current?.definitions ?? [],
      callTool: async (toolName, args) => {
        const live = holder.current
        if (!live) throw new Error('the tool surface is not mounted')
        return { content: await live.invoke(toolName, args) }
      }
    })
    holder.mcpEndpoint = mcpEndpoint

    webCtx.effect(() => {
      const disposers = []
      disposers.push(webCtx.webServer.register({
        kind: 'exact',
        path: '/mcp',
        handler: (req, res) => {
          void mcpEndpoint.handle(req, res).then((handled) => {
            if (!handled && !res.writableEnded) {
              res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ error: 'not found' }))
            }
          }).catch((error) => {
            webCtx.logger?.warn?.(error instanceof Error ? error : new Error(String(error)))
            if (!res.headersSent && !res.writableEnded) {
              res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ error: 'internal error' }))
            }
          })
        }
      }))
      disposers.push(webCtx.webServer.register({
        kind: 'exact',
        path: '/',
        handler: (req, res) => {
          const body = JSON.stringify(mcpEndpoint.identity())
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            'content-length': Buffer.byteLength(body)
          })
          res.end(body)
        }
      }))
      return () => {
        while (disposers.length > 0) {
          const dispose = disposers.pop()
          try {
            dispose()
          } catch {
            // keep unwinding
          }
        }
      }
    }, 'dsh-localcoding-mcp: mcp endpoint')

    // The URL a client must be told. A route handler never needs its own origin, but
    // Codex and the tunnel do, so it comes from configuration with the app's
    // conventional loopback address as the default.
    const origin = String(config.publicBaseUrl ?? '').replace(/\/+$/, '') || 'http://127.0.0.1:19387'
    holder.baseUrl = origin
    holder.mcpUrl = `${origin}/mcp`
    holder.modelUrl = config.modelBridgeEnabled === false ? undefined : `${origin}${MODEL_BASE_PATH}`
  })

  ctx.effect(() => {
    // Read every setting synchronously so a config edit re-runs this effect.
    const workspaceRoot = String(config.workspaceRoot ?? '')
    const sourceMode = config.sourceMode === 'external-mcp' ? 'external-mcp' : 'native'
    const toolTimeoutMs = Math.max(1_000, Number(config.toolTimeoutSeconds ?? 300) * 1_000)
    const externalMcpUrl = String(config.externalMcpUrl ?? '')
    const externalToken = String(config.externalMcpAuthToken ?? '')
    const codexModel = String(config.codexModel ?? '')
    const autoRegisterWithCodex = config.autoRegisterWithCodex === true
    const tunnelEnabled = config.tunnelEnabled === true
    const browserEnabled = config.browserEnabled === true
    const browserAutoStart = config.browserAutoStart === true
    const tunnelAutoStartAll = config.tunnelAutoStartAll === true

    if (workspaceRoot === '') throw new Error('workspaceRoot must be set to a directory')

    let live
    if (sourceMode === 'native') {
      const surface = createNativeSurface({ workspaceRoot, tools: ctx.tools, logger: ctx.logger })
      live = {
        kind: 'native',
        definitions: surface.definitions,
        describe: () => surface.describe(),
        /** Run one tool and render it, the same path the host takes. */
        async invoke (toolName, args) {
          const definition = surface.definitions.find((entry) => entry.name === toolName)
          if (!definition) throw new Error(`unknown tool: ${toolName}`)
          const value = await definition.execute(args ?? {}, {})
          return definition.output.render(args ?? {}, value)
        },
        dispose: () => surface.dispose()
      }
    } else {
      if (externalMcpUrl === '') throw new Error('externalMcpUrl must be set in external-mcp mode')
      const client = new McpHttpClient(externalMcpUrl, {
        headers: externalToken ? { Authorization: `Bearer ${externalToken}` } : {}
      })
      const bridge = new McpToolBridge({
        tools: ctx.tools,
        client,
        serverUrl: externalMcpUrl,
        timeoutMs: toolTimeoutMs,
        logger: ctx.logger
      })
      live = {
        kind: 'external',
        definitions: [],
        describe: () => bridge.describe(),
        async invoke (toolName, args) {
          const result = await bridge.invoke(toolName, args)
          return [{ type: 'text', text: result.text ?? '' }]
        },
        dispose: () => {
          bridge.dispose()
          void client.close()
        },
        start: async () => {
          // Attach-only: never spawn. A server that is not running is an error the
          // page reports, not something the plugin starts behind the user's back.
          const health = await probeExistingServer(externalMcpUrl.replace(/\/mcp$/, '/health'))
          if (!health) throw new Error(`no LocalCodingMCP server is answering at ${externalMcpUrl}`)
          await bridge.sync()
          return health
        }
      }
    }

    holder.current = live
    holder.live = { llm: ctx.get('llm') !== undefined }
    ctx.logger?.info?.(`[localcoding-mcp] mode=${sourceMode} workspace=${workspaceRoot} tools=${live.describe().toolCount}`)

    if (sourceMode === 'external-mcp') {
      void live.start?.().catch((error) => {
        ctx.logger?.warn?.(error instanceof Error ? error : new Error(String(error)))
      })
    }

    // `lcm_codex_task` needs an endpoint to tell Codex about. Without the web plane
    // it points at the conventional URL and says so, rather than being absent.
    const disposeCodex = ctx.tools.register(buildCodexToolDefinition({
      mcpUrl: holder.mcpUrl,
      workspaceRoot,
      resolvePath: () => resolveCodexPath(config.codexPath),
      logger: ctx.logger,
      defaultModel: codexModel || undefined
    }))

    const cleanup = []
    cleanup.push(() => {
      try {
        disposeCodex()
      } catch {
        // registry teardown must not mask the rest
      }
    })

    if (autoRegisterWithCodex && holder.mcpUrl !== undefined) {
      void ensureCodexMcpServer(resolveCodexPath(config.codexPath), CODEX_SERVER_NAME, holder.mcpUrl)
        .then((result) => ctx.logger?.info?.(`[localcoding-mcp] codex MCP server ${result.name} -> ${result.url}`))
        .catch((error) => ctx.logger?.warn?.(error instanceof Error ? error : new Error(String(error))))
    }

    // ---- GPT web → local ----
    //
    // The fleet publishes the MCP endpoint above. Starting daemons is opt-in on top
    // of enabling the fleet: each one opens an outbound connection to the OpenAI
    // control plane with a real credential.
    let fleet
    if (tunnelEnabled && holder.mcpUrl !== undefined) {
      fleet = new TunnelFleet({
        exePath: String(config.tunnelExePath ?? ''),
        accountsPath: String(config.tunnelAccountsPath ?? ''),
        profileDir: String(config.tunnelProfileDir ?? ''),
        logDir: String(config.tunnelLogDir ?? ''),
        controlPlaneBaseUrl: String(config.tunnelControlPlaneBaseUrl ?? DEFAULT_CONTROL_PLANE_BASE_URL),
        healthPortBase: Math.max(1024, Number(config.tunnelHealthPortBase ?? 8080)),
        readyTimeoutSeconds: Math.max(5, Number(config.tunnelReadyTimeoutSeconds ?? 45)),
        proxy: String(config.tunnelProxy ?? ''),
        mcpUrl: holder.mcpUrl,
        logger: ctx.logger
      })
      holder.tunnel = fleet
      if (tunnelAutoStartAll) {
        void fleet.startAll()
          .then(({ results }) => {
            const ready = results.filter((entry) => entry.state === 'READY').length
            ctx.logger?.info?.(`[localcoding-mcp/tunnel] ${ready}/${results.length} account tunnel(s) ready`)
          })
          .catch((error) => ctx.logger?.warn?.(error instanceof Error ? error : new Error(String(error))))
      }
    }

    // ---- optional browser surface ----
    let browser
    if (browserEnabled) {
      browser = createBrowserProcess({
        entry: String(config.browserEntry ?? ''),
        port: Math.max(1024, Number(config.browserPort ?? 8931)),
        autoStart: browserAutoStart,
        logger: ctx.logger
      })
      holder.browser = browser
      if (browserAutoStart) {
        void browser.start().catch((error) => ctx.logger?.warn?.(error instanceof Error ? error : new Error(String(error))))
      }
    }

    return () => {
      for (const step of cleanup) {
        try {
          step()
        } catch {
          // one failing step must not strand the others
        }
      }
      // Order matters: unregister the tools before tearing down the surface whose
      // closures they call, so a call racing the unload fails cleanly rather than
      // reaching into disposed state.
      live.dispose()
      holder.current = undefined
      holder.mcpUrl = undefined
      holder.modelUrl = undefined
      // Stop every daemon we started; `dispose()` never throws, so one stubborn
      // child cannot keep the rest alive.
      void Promise.all([fleet?.dispose(), browser?.dispose()])
      holder.tunnel = undefined
      holder.browser = undefined
    }
  }, 'dsh-localcoding-mcp: native tool surface')
}
