/**
 * A native MCP server over the plugin's own tool table.
 *
 * Serving MCP is not optional once the .NET server is gone: the GPT-web direction
 * works by publishing an MCP endpoint through the OpenAI tunnel, and `codex mcp add
 * --url` needs one too. Both used to point at `LocalCodingMCP.exe`; now they point
 * here, and the tools behind this endpoint are the same `ToolDefinition` records the
 * local agent gets, so there is exactly one implementation of each tool.
 *
 * Protocol details that are load-bearing, all verified against the old server's
 * behaviour because clients were already working against it:
 *
 *   - `POST /mcp` answers `text/event-stream`, with the JSON-RPC reply inside
 *     `event: message\ndata: {...}`. Some clients only read the SSE framing even
 *     though the request was a plain POST.
 *   - A session id comes back in the `Mcp-Session-Id` header and must be echoed by
 *     the client afterwards.
 *   - `GET /mcp` must exist and stay open. ChatGPT treats a 405 here as a broken
 *     connector ("connects, then Something went wrong"), so the stream is served
 *     and closed only when the client goes away.
 *   - a successful `tools/call` carries **no** `isError` field; its absence means
 *     success, and `content[0].text` is a JSON string for the structured payloads.
 */

import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'

/** Wire protocol revision this server implements. */
const PROTOCOL_VERSION = '2025-06-18'
/** Versions we can still answer if a client asks for something older. */
const KNOWN_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18'])

/** One JSON-RPC success envelope. */
function result (id, payload) {
  return { jsonrpc: '2.0', id, result: payload }
}

/** One JSON-RPC error envelope. */
function failure (id, code, message, data) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }
}

/** Frame one JSON-RPC message the way every MCP client expects to read it. */
function sse (message) {
  return `event: message\ndata: ${JSON.stringify(message)}\n\n`
}

/**
 * A native MCP endpoint bound to a tool table.
 *
 * @param {object} deps
 * @param {() => Array<object>} deps.listDefinitions returns the live tool definitions
 * @param {(name: string, args: object, exec?: object) => Promise<object>} deps.callTool
 *   runs one tool and resolves to `{ content, structured }`, or rejects
 * @param {string} deps.name server identity reported in `initialize`
 * @param {string} [deps.version]
 * @param {string} [deps.instructions] guidance sent to a connecting client
 * @param {string} [deps.workspaceRoot] advertised on `GET /`
 */
export function createMcpEndpoint (deps) {
  const sessions = new Map()
  /** Server-sent-event streams kept open for `GET /mcp`, keyed by session. */
  const streams = new Map()

  const sessionFor = (id) => (id === undefined ? undefined : sessions.get(id))

  /** Drop a session and close anything it left open. */
  const closeSession = (id) => {
    const stream = streams.get(id)
    if (stream) {
      try {
        stream.end()
      } catch {
        // The client may already be gone.
      }
      streams.delete(id)
    }
    sessions.delete(id)
  }

  /** Turn a tool definition into the `tools/list` row MCP clients expect. */
  const describeTool = (definition) => ({
    name: definition.name,
    description: definition.description,
    inputSchema: definition.parameters ?? { type: 'object', properties: {} },
    annotations: {
      // The host's own vocabulary, mapped to MCP's hints so a client can tell a
      // read from a destructive write without parsing the description.
      readOnlyHint: /^lcm_(read_|list_|search_|find_|get_|git_status|git_diff|git_log|git_recent|detect_|list_compilers)/.test(definition.name),
      destructiveHint: /^lcm_(delete_|clean_|undo_|kill_|git_restore)/.test(definition.name),
      idempotentHint: /^lcm_(read_|list_|search_|find_|get_|git_status|git_diff|git_log|detect_|list_compilers)/.test(definition.name),
      openWorldHint: /^lcm_(run_native_command|spawn_process|build_|run_tests|compile_)/.test(definition.name)
    }
  })

  return {
    /** The MCP route prefix; one endpoint serves every caller. */
    path: '/mcp',

    /**
     * Handle one HTTP request.
     *
     * @returns {Promise<boolean>} whether the request was handled here
     */
    async handle (req, res) {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname !== '/mcp') return false

      const sessionId = req.headers['mcp-session-id']

      if (req.method === 'GET') {
        // A long-lived stream. Some clients open it purely as a liveness check, so
        // it must stay open rather than answer and close.
        const id = sessionId ?? randomBytes(12).toString('hex')
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          'mcp-session-id': id
        })
        res.write(': connected\n\n')
        streams.set(id, res)
        const finish = () => {
          streams.delete(id)
          try {
            res.end()
          } catch {
            // already closed
          }
        }
        req.on?.('close', finish)
        return true
      }

      if (req.method === 'DELETE') {
        if (sessionId !== undefined) closeSession(sessionId)
        res.writeHead(204, { 'cache-control': 'no-store' })
        res.end()
        return true
      }

      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow: 'GET, POST, DELETE' })
        res.end(JSON.stringify(failure(null, -32600, 'Method not allowed')))
        return true
      }

      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      let message
      try {
        message = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(failure(null, -32700, 'Parse error')))
        return true
      }

      const id = message?.id ?? null
      const method = message?.method
      const params = message?.params ?? {}

      // A notification (no id) is acknowledged with 202 and no body.
      if (message?.id === undefined && typeof method === 'string' && method.startsWith('notifications/')) {
        res.writeHead(202, { 'cache-control': 'no-store' })
        res.end()
        return true
      }

      let payload
      let newSessionId
      try {
        switch (method) {
          case 'initialize': {
            const requested = String(params?.protocolVersion ?? PROTOCOL_VERSION)
            newSessionId = randomBytes(12).toString('hex')
            sessions.set(newSessionId, { createdAt: Date.now(), client: params?.clientInfo })
            payload = result(id, {
              protocolVersion: KNOWN_VERSIONS.has(requested) ? requested : PROTOCOL_VERSION,
              capabilities: { tools: { listChanged: true }, logging: {} },
              serverInfo: { name: deps.name, version: deps.version ?? '1.0.0' },
              ...(deps.instructions ? { instructions: deps.instructions } : {})
            })
            break
          }
          case 'ping':
            payload = result(id, {})
            break
          case 'tools/list':
            payload = result(id, {
              tools: (deps.listDefinitions() ?? []).map(describeTool)
            })
            break
          case 'tools/call': {
            const name = String(params?.name ?? '')
            if (name === '') throw Object.assign(new Error('tools/call requires a name'), { code: -32602 })
            const definition = (deps.listDefinitions() ?? []).find((entry) => entry.name === name)
            if (!definition) {
              // Per the spec an unknown tool is an error result, not a transport error.
              payload = result(id, {
                content: [{ type: 'text', text: `Unknown tool: ${name}` }],
                isError: true
              })
              break
            }
            try {
              const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {}
              const outcome = await deps.callTool(name, args)
              payload = result(id, {
                content: outcome.content,
                ...(outcome.structured === undefined ? {} : { structuredContent: outcome.structured })
              })
            } catch (error) {
              // A tool that threw is a successful JSON-RPC call whose result says
              // the tool failed; that is what always-present `isError` is for.
              payload = result(id, {
                content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
                isError: true
              })
            }
            break
          }
          case 'resources/list':
            payload = result(id, { resources: [] })
            break
          case 'resources/templates/list':
            payload = result(id, { resourceTemplates: [] })
            break
          case 'prompts/list':
            payload = result(id, { prompts: [] })
            break
          default:
            payload = failure(id, -32601, `Method not found: ${method}`)
            break
        }
      } catch (error) {
        payload = failure(id, error?.code ?? -32603, error instanceof Error ? error.message : String(error))
      }

      const headers = {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store'
      }
      if (newSessionId !== undefined) headers['mcp-session-id'] = newSessionId
      else if (typeof sessionId === 'string' && sessions.has(sessionId)) headers['mcp-session-id'] = sessionId
      res.writeHead(200, headers)
      res.end(sse(payload))
      return true
    },

    /** Identity payload for `GET /` — the old server advertised itself this way. */
    identity () {
      return {
        name: deps.name,
        version: deps.version ?? '1.0.0',
        protocolVersion: PROTOCOL_VERSION,
        workspace: deps.workspaceRoot,
        tools: (deps.listDefinitions() ?? []).length,
        sessions: sessions.size
      }
    },

    /** Live session count, for the settings page. */
    get sessionCount () {
      return sessions.size
    },

    dispose () {
      for (const id of [...sessions.keys()]) closeSession(id)
      sessions.clear()
      streams.clear()
    }
  }
}

export { PROTOCOL_VERSION, KNOWN_VERSIONS, sse }