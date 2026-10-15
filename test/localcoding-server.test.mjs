/**
 * End-to-end exercise of the dsh-localcoding-mcp server half against a live
 * LocalCodingMCP instance: starts nothing (it adopts whatever is already on the
 * configured port), lists tools, calls one, and prints the shape the host would
 * render. Run with:
 *
 *   node test/localcoding-server.test.mjs
 *
 * Environment: LCM_URL (default http://127.0.0.1:3011/mcp), LCM_TOKEN (optional
 * bearer token). It is a live probe, not a hermetic unit test: if nothing is
 * listening, it fails loudly rather than skipping.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { McpHttpClient } = require('../dsh-localcoding-mcp/server/mcp-client.js')
const { McpToolBridge, PREFIX } = require('../dsh-localcoding-mcp/server/bridge.js')

const url = process.env.LCM_URL ?? 'http://127.0.0.1:3011/mcp'
const token = process.env.LCM_TOKEN ?? ''

/* ── a tools registry shaped like the host's ─────────────────────────────── */
const registry = new Map()
const tools = {
  register (definition) {
    if (registry.has(definition.name)) throw new Error(`duplicate tool ${definition.name}`)
    registry.set(definition.name, definition)
    return () => { registry.delete(definition.name) }
  }
}

const client = new McpHttpClient(url, token ? { headers: { Authorization: `Bearer ${token}` } } : {})
const bridge = new McpToolBridge({ tools, client, serverUrl: url, timeoutMs: 60_000 })

const tools_ = await bridge.sync()
assert.ok(tools_.length > 20, `only ${tools_.length} tools discovered`)
assert.ok(registry.has(`${PREFIX}read_file`), 'read_file was not bridged')
assert.ok(registry.has(`${PREFIX}write_file`), 'write_file was not bridged')
assert.ok(registry.has(`${PREFIX}git_status`), 'git_status was not bridged')
console.log(`registered ${registry.size} tools as ${PREFIX}*`)

// Every registered schema must survive the host's JSON Schema subset, and every
// name must avoid the reserved `run_code` slot.
const { buildParameters } = require('../dsh-localcoding-mcp/server/bridge.js')
for (const [name, definition] of registry) {
  if (name === 'run_code') throw new Error('registered the reserved name run_code')
  const params = definition.parameters
  if (params?.type !== 'object') throw new Error(`${name} parameters are ${params?.type}`)
  for (const key of params.required ?? []) {
    if (!params.properties?.[key]) throw new Error(`${name} requires unknown property ${key}`)
  }
  assert.ok(definition.output?.schema && typeof definition.output.render === 'function', `${name} has no output definition`)
}

/* ── a real call: read the workspace the server is mounted on ────────────── */
const probe = await bridge.invoke('get_workspace_info', {})
assert.equal(probe.ok, true, `get_workspace_info failed: ${probe.text}`)
assert.equal(probe.tool, 'get_workspace_info')
assert.ok(probe.durationMs >= 0)
assert.match(probe.text, /"root"/)
assert.equal(probe.data.root, 'E:\\ai\\dsh-plugins')
console.log(`get_workspace_info ok in ${probe.durationMs}ms, ${probe.text.length} chars`)

// The host renders whatever `output.render` returns; it must be content blocks.
const definition = registry.get(`${PREFIX}get_workspace_info`)
const blocks = definition.output.render({ path: 'get_workspace_info' }, probe)
assert.ok(Array.isArray(blocks) && blocks.length > 0, 'render returned no blocks')
assert.equal(blocks[0].type, 'text')
assert.match(blocks[0].text, /LocalCodingMCP|"root"/)
console.log(`render produced ${blocks.length} block(s): ${blocks[0].type}`)

/* ── the failure path must throw, not return an isError value ────────────── */
const missing = registry.get(`${PREFIX}delete_file`)
assert.ok(missing, 'delete_file missing')
await assert.rejects(
  () => missing.execute({ path: 'E:/definitely/not/here.txt' }, { signal: undefined }),
  (error) => {
    assert.ok(error instanceof Error)
    assert.ok(error.message.length > 0)
    return true
  }
)
console.log('failure path throws as the host expects')

/* ── abort must be honoured mid-call ────────────────────────────────────── */
const controller = new AbortController()
const pending = bridge.invoke('run_native_command', {
  executable: 'cmd.exe', arguments: ['/c', 'ping -n 30 127.0.0.1'], timeoutSeconds: 25
}, controller.signal)
setTimeout(() => controller.abort(), 300)
await assert.rejects(() => pending, /abort|cancel/i)
console.log('abort propagates')

bridge.dispose()
await client.close()
assert.equal(registry.size, 0, 'dispose left tools registered')
console.log('OK')