/**
 * Loopback JSON routes backing the Settings section.
 *
 * The embedded web UI is the only caller, so every route is an exact loopback
 * route and non-POST verbs are refused. Reads never touch the MCP server beyond a
 * health probe; writes drive the process lifecycle, the tool registry, and Codex.
 */

import { Buffer } from 'node:buffer'

const LOOPBACK = new Set(['::1', '127.0.0.1', '::ffff:127.0.0.1'])

/** True for the loopback addresses the embedded UI is served from. */
function isLoopbackAddress (address) {
  return address !== undefined && (LOOPBACK.has(address) || address.startsWith('127.'))
}

/** Refuse anything that did not arrive from the local app itself. */
function isTrustedRequest (req) {
  return !req.headers.forwarded && isLoopbackAddress(req.socket.remoteAddress)
}

function sendJson (res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  })
  res.end(body)
}

/** Read one JSON request body, tolerating an empty or malformed stream. */
async function readJson (req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

/**
 * Mount every settings route.
 *
 * @param {object} webCtx the injected `webServer` context (logger + webServer)
 * @param {object} controller live plugin controller, see index.js
 */
export function registerRoutes (webCtx, controller) {
  const disposers = []
  const add = (path, handler) => disposers.push(webCtx.webServer.register({ kind: 'exact', path, handler }))

  const fail = (res, error) => {
    webCtx.logger?.warn?.(error instanceof Error ? error : new Error(String(error)))
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }

  /** Gate shared by every route: loopback only, GET allowed for reads. */
  const guard = (req, res, expect) => {
    if (!isTrustedRequest(req)) {
      sendJson(res, 403, { error: 'Request rejected.' })
      return false
    }
    if (req.method !== expect) {
      sendJson(res, 405, { error: 'Method not allowed.' })
      return false
    }
    return true
  }

  const get = (path, run) => {
    add(path, async (req, res) => {
      if (!guard(req, res, 'GET')) return
      try {
        sendJson(res, 200, await run(new URL(req.url, 'http://localhost')))
      } catch (error) {
        fail(res, error)
      }
    })
  }

  const action = (path, run) => {
    add(path, async (req, res) => {
      if (!guard(req, res, 'POST')) return
      let body
      try {
        body = await readJson(req)
        if (body === undefined) {
          sendJson(res, 400, { error: 'Body must be JSON.' })
          return
        }
        sendJson(res, 200, await run(body))
      } catch (error) {
        fail(res, error)
      }
    })
  }

  const base = '/dsh-localcoding-mcp'

  /** Reject a missing query/body field with a message the page can show verbatim. */
  const requireParam = (value, name) => {
    const text = typeof value === 'string' ? value.trim() : ''
    if (!text) throw new Error(`${name} is required`)
    return text
  }

  /** Full status snapshot: process, tools, Codex, and effective settings. */
  get(`${base}/status`, async () => controller.status())

  /** Just the process state; polled by the page while a start is in flight. */
  get(`${base}/health`, async () => controller.health())

  /** Tools currently bridged into the host registry. */
  get(`${base}/tools`, async () => controller.tools())

  /** Recent server stdout/stderr lines for the diagnostics panel. */
  get(`${base}/logs`, async (url) => ({ logs: controller.logs(Number(url.searchParams.get('limit') ?? 40)) }))

  /** MCP handshake facts plus the first lines of the server's instructions. */
  get(`${base}/probe`, async () => controller.probe())

  /** Tools the server exposes right now, even if they are not registered. */
  get(`${base}/available`, async () => controller.availableTools())

  action(`${base}/start`, async () => controller.start())
  action(`${base}/stop`, async () => controller.stop())
  action(`${base}/restart`, async () => controller.restart())
  action(`${base}/refresh-tools`, async () => controller.refreshTools())

  /** Register our /mcp endpoint with `codex mcp add --url`. */
  action(`${base}/codex/register`, async () => controller.registerWithCodex())
  action(`${base}/codex/unregister`, async () => controller.unregisterFromCodex())

  // ---- GPT web → local: one tunnel-client process per ChatGPT account ----

  /** Accounts from `accounts.json` plus live state; polled with /status. */
  get(`${base}/tunnel/accounts`, async () => controller.tunnelDescribe())

  /** Operator surfaces for one account (`/readyz`, `/healthz`, the UI URL). */
  get(`${base}/tunnel/probe`, async (url) => controller.tunnelProbe(requireParam(url.searchParams.get('id'), 'id')))

  /** `tunnel-client doctor --explain` for one account. */
  get(`${base}/tunnel/doctor`, async (url) => controller.tunnelDoctor(requireParam(url.searchParams.get('id'), 'id')))

  /** Start one account's tunnel. */
  action(`${base}/tunnel/start`, async (body) => controller.tunnelStart(requireParam(body.id, 'id')))

  /** Start every configured account. */
  action(`${base}/tunnel/start-all`, async () => controller.tunnelStartAll())

  /** Stop one account's tunnel. */
  action(`${base}/tunnel/stop`, async (body) => controller.tunnelStop(requireParam(body.id, 'id')))

  /** Stop every tunnel this plugin started. */
  action(`${base}/tunnel/stop-all`, async () => controller.tunnelStopAll())

  // ---- optional browser surface for the same ChatGPT connector ----

  get(`${base}/browser`, async () => controller.browserDescribe())
  action(`${base}/browser/start`, async () => controller.browserStart())
  action(`${base}/browser/stop`, async () => controller.browserStop())

  /**
   * Call one MCP tool straight from the page, bypassing the agent. Used by the
   * "try a tool" console so a broken registration is visible without a chat turn.
   */
  action(`${base}/call`, async (body) => {
    const name = typeof body.tool === 'string' ? body.tool : ''
    if (!name) throw new Error('tool is required')
    const args = body.arguments && typeof body.arguments === 'string'
      ? JSON.parse(body.arguments)
      : body.arguments ?? {}
    return controller.callTool(name, args)
  })

  webCtx.effect(() => () => {
    while (disposers.length > 0) {
      const dispose = disposers.pop()
      try {
        dispose()
      } catch {
        // A disposer that throws must not strand the ones still queued.
      }
    }
  }, 'dsh-localcoding-mcp: settings routes')
}

export { isLoopbackAddress, isTrustedRequest, sendJson, readJson }
