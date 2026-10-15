/**
 * Streamable-HTTP MCP client (protocol revision 2025-06-18 subset).
 *
 * LocalCodingMCP speaks SSE-framed responses over POST /mcp and hands back an
 * `Mcp-Session-Id` header that must be echoed on every later request. We never
 * open the server→client GET stream: it stays open for the life of the session
 * and a leaked socket per session buys only notifications we do not consume.
 */

const PROTOCOL_VERSION = '2025-06-18'
const CLIENT_INFO = { name: 'dsh-localcoding-mcp', version: '0.1.0' }
const DEFAULT_TIMEOUT_MS = 120_000

/** Error whose message is the server's own complaint, not a transport failure. */
export class McpToolError extends Error {
  constructor (message, info, cause) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'McpToolError'
    this.info = info
  }
}

function isPlainObject (value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parse an SSE body into its `message` payloads. */
function parseSse (text) {
  const messages = []
  for (const block of text.split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue
    const data = []
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) continue
      if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    if (!data.length) continue
    const raw = data.join('\n')
    try {
      messages.push(JSON.parse(raw))
    } catch {
      messages.push(raw)
    }
  }
  return messages
}

/** Pick the JSON-RPC message out of an SSE or plain-JSON response. */
function pickMessage (text, contentType) {
  const messages = parseSse(text)
  for (const message of messages) {
    if (isPlainObject(message) && message.jsonrpc) return message
  }
  if (!String(contentType).includes('text/event-stream')) {
    try { return JSON.parse(text) } catch { /* not plain JSON */ }
  }
  if (messages.length === 1) return messages[0]
  return { jsonrpc: '2.0', id: null, error: { code: -32603, message: text.slice(0, 2000) } }
}

/**
 * Merge the caller's abort signal with a per-request timeout.
 *
 * The duck-typed check has to come first: an `AbortSignal` is a plain
 * `typeof === 'object'` value, so an `isPlainObject` test would classify it as
 * "not really a signal" and silently drop the caller's cancellation. What the
 * host actually hands `exec.signal` is unverified, so anything without an
 * `addEventListener` is discarded instead of passed to `AbortSignal.any`,
 * which would throw a hard `ERR_INVALID_ARG_TYPE`.
 */
function withDeadline (signal, timeoutMs) {
  const deadline = AbortSignal.timeout(timeoutMs)
  return typeof signal?.addEventListener === 'function'
    ? AbortSignal.any([signal, deadline])
    : deadline
}

export class McpHttpClient {
  /**
   * @param {string} endpoint absolute /mcp URL, e.g. http://127.0.0.1:3011/mcp
   * @param {{ timeoutMs?: number, headers?: Record<string,string> }} [options]
   */
  constructor (endpoint, options = {}) {
    this.endpoint = endpoint
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.headers = { ...options.headers }
    this.sessionId = undefined
    this.serverInfo = undefined
    this.instructions = undefined
    this.capabilities = undefined
    this.nextId = 1
    this.initializing = undefined
  }

  get connected () {
    return this.sessionId !== undefined
  }

  #absorbSession (response) {
    const id = response.headers.get('mcp-session-id')
    if (id) this.sessionId = id
  }

  /** One POST to /mcp; returns the parsed JSON-RPC message. */
  async #post (payload, { signal, timeoutMs, keepSession = true } = {}) {
    const headers = { Accept: 'application/json, text/event-stream', ...this.headers }
    if (payload !== undefined) headers['Content-Type'] = 'application/json'
    if (this.sessionId !== undefined) headers['Mcp-Session-Id'] = this.sessionId

    const deadline = withDeadline(signal, timeoutMs ?? this.timeoutMs)
    let response
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: deadline
      })
      const text = await response.text()
      if (keepSession) this.#absorbSession(response)
      if (!response.ok && !text) {
        throw new McpToolError(`MCP server answered HTTP ${response.status} ${response.statusText}`)
      }
      return pickMessage(text, response.headers.get('content-type'))
    } catch (error) {
      // An abort must stay an abort: `fetch` rejects with a DOMException, and
      // flattening that into a tool error would hide the reason the host gave
      // for tearing the call down in the first place.
      if (deadline.aborted) throw error
      if (error instanceof McpToolError) throw error
      throw new McpToolError(
        error instanceof Error ? error.message : String(error),
        undefined,
        error
      )
    }
  }

  /** Send one JSON-RPC request and unwrap its result. */
  async #rpc (method, params, options = {}) {
    const message = await this.#post(
      { jsonrpc: '2.0', id: this.nextId++, method, ...params === undefined ? {} : { params } },
      options
    )
    if (message?.error) throw new McpToolError(message.error.message ?? 'MCP request failed', message.error)
    if (message?.result === undefined) throw new McpToolError(`MCP ${method} returned no result`)
    return message.result
  }

  /** Fire-and-forget JSON-RPC notification. */
  async #notify (method, params) {
    try {
      await this.#post({ jsonrpc: '2.0', method, ...params === undefined ? {} : { params } }, { timeoutMs: 15_000 })
    } catch {
      // Best-effort: the server keeps working without client notifications.
    }
  }

  /** Initialize the session once; concurrent callers share the same handshake. */
  async ensureSession (options = {}) {
    if (this.sessionId !== undefined) return this
    if (this.initializing) return this.initializing
    this.initializing = (async () => {
      const result = (await this.#post({
        jsonrpc: '2.0',
        id: this.nextId++,
        method: 'initialize',
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { roots: { listChanged: true } },
          clientInfo: CLIENT_INFO
        }
      }, { timeoutMs: options.timeoutMs ?? 20_000 })).result
      this.serverInfo = result?.serverInfo
      this.capabilities = result?.capabilities
      this.instructions = result?.instructions
      await this.#notify('notifications/initialized')
      return this
    })()
    try {
      return await this.initializing
    } finally {
      this.initializing = undefined
    }
  }

  /** Forget the session; the next call re-initializes against a fresh id. */
  reset () {
    this.sessionId = undefined
    this.serverInfo = undefined
    this.capabilities = undefined
    this.instructions = undefined
  }

  /** List every tool the server exposes. */
  async listTools (options = {}) {
    await this.ensureSession(options)
    return (await this.#rpc('tools/list', {}, options))?.tools ?? []
  }

  /**
   * Invoke one tool.
   * @returns {Promise<{ isError: boolean, text: string, content: unknown[], structured?: unknown }>}
   */
  async callTool (name, args = {}, options = {}) {
    await this.ensureSession(options)
    const result = await this.#rpc('tools/call', { name, arguments: args ?? {} }, options)
    const content = Array.isArray(result?.content) ? result.content : []
    return {
      isError: result?.isError === true,
      content,
      text: content.filter((block) => block?.type === 'text').map((block) => block.text).join('\n'),
      structured: result?.structuredContent
    }
  }

  /** Best-effort session teardown; the process dies with the server anyway. */
  async close () {
    const sessionId = this.sessionId
    if (sessionId === undefined) return
    this.reset()
    try {
      await fetch(this.endpoint, {
        method: 'DELETE',
        headers: { ...this.headers, 'Mcp-Session-Id': sessionId },
        signal: AbortSignal.timeout(5_000)
      })
    } catch {
      // Servers that do not implement DELETE are common enough to ignore.
    }
  }
}

/** Extract the JSON payload a tool result hides inside its text content. */
export function parseToolJson (text) {
  if (typeof text !== 'string') return undefined
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined
  try { return JSON.parse(trimmed) } catch { return undefined }
}
