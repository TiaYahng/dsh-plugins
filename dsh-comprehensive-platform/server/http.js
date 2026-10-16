/**
 * Shared loopback-JSON plumbing for every route this plugin mounts.
 *
 * Every surface the client talks to is an exact loopback route: the embedded
 * web UI is the only caller, and it always runs on the machine that serves it.
 * Nothing here inspects a body or a query — that is each route module's job.
 *
 * @module dsh-comprehensive-platform/server/http
 */
import { Buffer } from 'node:buffer'

/** True for the loopback addresses the embedded UI is served from. */
export function isLoopbackAddress(address) {
  if (address === undefined) return false
  if (address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1') return true
  return address.startsWith('127.')
}

/** Refuse anything that did not arrive from the local app itself. */
export function isTrustedRequest(req) {
  return !req.headers.forwarded && isLoopbackAddress(req.socket.remoteAddress)
}

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  })
  res.end(body)
}

/** Read one JSON request body, tolerating an empty stream. */
export async function readJson(req) {
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
 * One route failure: log it where the harness log lives, answer with a message
 * the Settings page can put on screen. Shared so no route invents its own
 * error shape.
 */
export function fail(webCtx, res, error) {
  webCtx.logger?.warn?.(error instanceof Error ? error : new Error(String(error)))
  sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
}

/**
 * The route table one mounted web server owns.
 *
 * Registration order is irrelevant to the host, but disposal order matters to
 * us: `dispose` must run every disposer even when one throws, or a half-torn
 * web server keeps serving a route nobody can reach.
 */
export function createRouteTable(webCtx) {
  const disposers = []
  return {
    add(path, handler) {
      disposers.push(webCtx.webServer.register({ kind: 'exact', path, handler }))
    },
    /** Register a read-only route whose answer is computed by `run`. */
    get(path, run) {
      this.add(path, async (req, res) => {
        if (!isTrustedRequest(req)) return sendJson(res, 403, { error: 'Request rejected.' })
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' })
        try {
          sendJson(res, 200, await run(new URL(req.url, 'http://localhost')))
        } catch (error) {
          fail(webCtx, res, error)
        }
      })
    },
    /** Reject anything that is not a loopback POST. */
    post(req, res) {
      if (!isTrustedRequest(req)) {
        sendJson(res, 403, { error: 'Request rejected.' })
        return false
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed.' })
        return false
      }
      return true
    },
    dispose() {
      while (disposers.length > 0) {
        const dispose = disposers.pop()
        try {
          dispose()
        } catch {
          // A disposer that throws must not strand the ones still queued.
        }
      }
    }
  }
}