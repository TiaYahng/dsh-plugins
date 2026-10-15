/**
 * Bridge between MCP tools and DSH tools.
 *
 * Every LocalCodingMCP tool becomes one DSH tool named `lcm_<tool>` so that
 * names such as `read_file` cannot shadow the host's native `read`/`edit`/`grep`
 * family. The MCP input schema is forwarded as-is when it fits the JSON Schema
 * subset the host accepts, and degraded otherwise; the MCP result text is parsed
 * as JSON when possible so the model sees structured data instead of a blob.
 */

import { McpToolError, parseToolJson } from './mcp-client.js'

const PREFIX = 'lcm_'
const MAX_SCHEMA_DEPTH = 12
const MAX_SCHEMA_PROPERTIES = 200

/** MCP annotations that map cleanly onto DSH's render budget. */
const EXECUTION_MUTATING = new Set(['write_file', 'create_file', 'apply_patch', 'delete_file', 'delete_directory',
  'create_directory', 'rename_file', 'move_file', 'copy_file', 'git_commit', 'git_restore_file', 'undo_last_change'])

const READ_ONLY_TOOLS = new Set(['read_file', 'search_code', 'find_definitions', 'list_files', 'get_agent_rules',
  'get_agent_context', 'get_workspace_info', 'git_status', 'git_diff', 'git_log', 'list_processes', 'read_process_output',
  'detect_build_tools', 'detect_project', 'list_compilers', 'list_local_mcp_tools', 'list_recent_changes'])

/** Tools that hold a long-lived OS process; never safe to run concurrently. */
const PROCESS_TOOLS = new Set(['spawn_process', 'read_process_output', 'write_process_stdin', 'kill_process'])

/** Tools whose MCP `parameters` schema the host would reject as-is. */
const SCHEMA_DROP_PROPS = new Set(['$schema', 'additionalProperties', '$id', '$ref', 'definitions', '$defs', 'default', 'examples'])

function isPlainObject (value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Narrow one MCP schema node to the subset `tools.register` accepts, or return
 * `undefined` when the node cannot be expressed (caller then falls back).
 */
function narrowSchema (schema, depth = 0) {
  if (!isPlainObject(schema) || depth > MAX_SCHEMA_DEPTH) return undefined
  const type = typeof schema.type === 'string' ? schema.type : undefined
  switch (type) {
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
    case 'null':
      return { type }
    case 'array': {
      const items = narrowSchema(schema.items, depth + 1)
      return items ? { type: 'array', items } : undefined
    }
    case 'object': {
      const properties = {}
      let count = 0
      for (const [key, value] of Object.entries(schema.properties ?? {})) {
        if (count >= MAX_SCHEMA_PROPERTIES) break
        if (SCHEMA_DROP_PROPS.has(key)) continue
        const narrowed = narrowSchema(value, depth + 1)
        if (!narrowed) continue
        properties[key] = narrowed
        count++
      }
      const required = Array.isArray(schema.required)
        ? schema.required.filter((key) => key in properties)
        : undefined
      return {
        type: 'object',
        properties,
        ...required === undefined || required.length === 0 ? {} : { required: [...new Set(required)] }
      }
    }
    case undefined:
      // An untyped node carrying `enum` still constrains a string usefully.
      return Array.isArray(schema.enum) && schema.enum.every((item) => typeof item === 'string')
        ? { type: 'string', enum: [...schema.enum] }
        : undefined
    default:
      return undefined
  }
}

/**
 * Compose a DSH `parameters` object from the MCP tool schema, falling back to a
 * single free-form `arguments` string when the MCP schema cannot be expressed in
 * the JSON Schema subset `tools.register` enforces.
 */
export function buildParameters (mcpTool) {
  const schema = isPlainObject(mcpTool.inputSchema)
    ? mcpTool.inputSchema
    : isPlainObject(mcpTool.parameters) ? mcpTool.parameters : undefined
  const narrowed = narrowSchema(schema)
  if (narrowed?.type === 'object' && Object.keys(narrowed.properties).length > 0) return narrowed
  const hint = typeof mcpTool.description === 'string' ? mcpTool.description : ''
  return {
    type: 'object',
    properties: {
      arguments: {
        type: 'string',
        description: `JSON object of arguments for ${mcpTool.name}, e.g. {"path":"src/index.ts"}. ${hint}`.slice(0, 3000)
      }
    }
  }
}

/** Collect image blocks so `read_image` results survive the JSON round-trip. */
function collectImages (result) {
  const images = []
  for (const block of result.content ?? []) {
    if (block?.type === 'image' && typeof block.data === 'string' && block.data) {
      images.push({ data: block.data, mimeType: typeof block.mimeType === 'string' ? block.mimeType : 'image/png' })
    }
  }
  return images
}

/** Value handed to the host; `output.schema` is an open object schema. */
function toolValue (args, result, toolName, durationMs) {
  const parsed = result.structured ?? parseToolJson(result.text)
  const images = collectImages(result)
  return {
    tool: toolName,
    ok: result.isError !== true,
    durationMs,
    text: result.text,
    // Echo the arguments the model actually used so a card can show them.
    ...(isPlainObject(args) && Object.keys(args).length ? { arguments: args } : {}),
    ...(isPlainObject(parsed) || Array.isArray(parsed) ? { data: parsed } : {}),
    ...(images.length ? { images } : {})
  }
}

/** Human-facing tool description, prefixed with provenance. */
function toolDescription (mcpTool, serverUrl) {
  const base = typeof mcpTool.description === 'string' && mcpTool.description.trim()
    ? mcpTool.description.trim()
    : `Invoke the LocalCodingMCP tool ${mcpTool.name}.`
  return `[LocalCodingMCP @ ${serverUrl}] ${base}`.slice(0, 4000)
}

/** Stable output schema: an open object so the host accepts any payload. */
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    tool: { type: 'string' },
    ok: { type: 'boolean' },
    durationMs: { type: 'number' },
    text: { type: 'string' },
    arguments: { type: 'object', properties: {}, additionalProperties: true },
    images: {
      type: 'array',
      items: {
        type: 'object',
        properties: { data: { type: 'string' }, mimeType: { type: 'string' } },
        additionalProperties: true
      }
    }
  },
  additionalProperties: true
}

function renderResult (_args, value) {
  const text = typeof value?.text === 'string' ? value.text : ''
  const prefix = value?.ok === false ? 'MCP tool reported a failure.\n\n' : ''
  const blocks = []
  if (text) blocks.push({ type: 'text', text: `${prefix}${text}` })
  else if (value?.ok === false) blocks.push({ type: 'text', text: `${prefix}The tool returned no text output.` })
  const callArgs = value?.arguments
  if (callArgs && Object.keys(callArgs).length && !/^\s*\{/.test(text)) {
    blocks.push({ type: 'text', text: `\nArguments: ${JSON.stringify(callArgs).slice(0, 2000)}` })
  }
  return blocks.length ? blocks : [{ type: 'text', text: '(empty result)' }]
}

/**
 * Build the DSH tool definition for one MCP tool.
 * @returns {import('@deepseek-ai/dsh-tools').ToolDefinition}
 */
export function buildToolDefinition (mcpTool, deps) {
  const { invoke } = deps
  const name = PREFIX + mcpTool.name.replace(/[^A-Za-z0-9_]/g, '_')
  return {
    name,
    description: toolDescription(mcpTool, deps.serverUrl),
    parameters: buildParameters(mcpTool),
    output: { schema: OUTPUT_SCHEMA, render: renderResult },
    timeoutMs: deps.timeoutMs ?? 300_000,
    isConcurrencySafe: () => !PROCESS_TOOLS.has(mcpTool.name) && !EXECUTION_MUTATING.has(mcpTool.name),
    async execute (args, exec) {
      const callArgs = args?.arguments !== undefined
        ? (() => {
            const parsed = typeof args.arguments === 'string' ? parseToolJson(args.arguments) : args.arguments
            return isPlainObject(parsed) ? parsed : {}
          })()
        : (isPlainObject(args) ? args : {})
      let result
      try {
        // The normalized value carries `ok`, not `isError`; a failed MCP call is
        // the one case that must reach the host as a thrown error.
        result = await invoke(mcpTool.name, callArgs, exec?.signal)
      } catch (error) {
        // Transport failures must reach the host as thrown errors, never as a
        // value: an `ok:false` payload would read to the agent as "done, but
        // nothing came back" instead of "this failed, try something else".
        throw new McpToolError(error instanceof Error ? error.message : String(error), undefined, error)
      }
      if (result.ok === false) throw new McpToolError(result.text.slice(0, 4000) || `${mcpTool.name} failed`)
      return result
    }
  }
}

/** Registry of every bridged tool, with hot re-sync when the server changes. */
export class McpToolBridge {
  /**
   * @param {{ tools: { register(d: unknown): () => void }, logger?: { info?: Function, warn?: Function },
   *           client: { listTools(): Promise<unknown[]>, callTool(n: string, a: unknown, o?: unknown): Promise<unknown> },
   *           serverUrl: string, timeoutMs?: number }} deps
   */
  constructor (deps) {
    this.ctx = deps.tools
    this.client = deps.client
    this.serverUrl = deps.serverUrl
    this.timeoutMs = deps.timeoutMs
    this.logger = deps.logger
    this.disposers = []
    this.registered = []
    this.lastError = undefined
    this.lastSyncAt = undefined
  }

  get toolNames () {
    return this.registered.map((tool) => tool.name)
  }

  /**
   * Call one MCP tool by its original name, with the caller signal wired.
   *
   * Returns the same normalized value `execute` hands the host, so the settings
   * page and the tool path observe identical output shapes. The host hands
   * `exec.signal` through as the third argument of the closure
   * `buildToolDefinition` was given, so this accepts either a bare
   * `AbortSignal` or an execution context carrying one.
   */
  async invoke (toolName, args, signal) {
    // An execution context may carry the signal as `.signal`; a bare AbortSignal
    // is used as-is. Anything else means "no signal" rather than a crash inside
    // `AbortSignal.any`.
    const resolved = typeof signal?.addEventListener === 'function'
      ? signal
      : typeof signal?.signal?.addEventListener === 'function' ? signal.signal : undefined
    const startedAt = Date.now()
    const result = await this.client.callTool(toolName, args, { signal: resolved, timeoutMs: this.timeoutMs })
    return toolValue(args, result, toolName, Date.now() - startedAt)
  }

  /** Register every tool the server currently exposes. */
  async sync () {
    const mcpTools = await this.client.listTools()
    const seen = new Set()
    for (const mcpTool of mcpTools) {
      if (typeof mcpTool?.name !== 'string') continue
      const definition = buildToolDefinition(mcpTool, {
        invoke: (name, args, signal) => this.invoke(name, args, signal),
        serverUrl: this.serverUrl,
        timeoutMs: this.timeoutMs
      })
      if (seen.has(definition.name)) continue
      seen.add(definition.name)
      try {
        this.disposers.push(this.ctx.register(definition))
        this.registered.push(definition)
      } catch (error) {
        // A name clash must not abort the whole sync: log and keep the rest.
        this.logger?.warn?.(`[localcoding-mcp] could not register ${definition.name}: ${error.message}`)
        this.lastError = `register ${definition.name}: ${error.message}`
      }
    }
    this.lastSyncAt = Date.now()
    this.logger?.info?.(`[localcoding-mcp] registered ${this.registered.length}/${mcpTools.length} tools from ${this.serverUrl}`)
    return this.registered.slice()
  }

  /** Metadata for the settings page. */
  describe () {
    return {
      toolCount: this.registered.length,
      tools: this.registered.map((tool) => ({
        name: tool.name,
        registeredName: tool.name,
        mcpName: tool.name.slice(PREFIX.length),
        description: tool.description.slice(0, 300),
        readOnly: READ_ONLY_TOOLS.has(tool.name.slice(PREFIX.length))
      })),
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError
    }
  }

  /** Unregister everything on dispose so a restart re-registers cleanly. */
  dispose () {
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose()
      } catch { /* a disposed registry must not break plugin teardown */ }
    }
    this.registered = []
  }
}

export { PREFIX, READ_ONLY_TOOLS, EXECUTION_MUTATING, PROCESS_TOOLS }
