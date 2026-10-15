/**
 * Process-manager and Codex-helper checks. These spawn and kill real processes
 * but never touch the user's `~/.codex/config.toml` unless CODEX_TEST_REAL=1.
 *
 *   node test/localcoding-process.test.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { McpServerProcess, probeExistingServer, findFreePort } = require('../dsh-localcoding-mcp/server/process.js')
const { resolveCodexPath, probeCodex, listCodexMcpServers } = require('../dsh-localcoding-mcp/server/codex.js')

const EXE = process.env.LCM_EXE
  ?? 'E:\\ai\\aiassistant\\plugins\\LocalCodingMCP_v0_3\\mcp-accounts\\bin\\Release\\net8.0\\win-x64\\LocalCodingMCP.exe'

/* ── port picking must never hand back something already in use ─────────── */
const chosen = await findFreePort(3011)
assert.ok(typeof chosen === 'number' && chosen > 0, `findFreePort returned ${chosen}`)
if (chosen !== 3011) console.log(`port 3011 was taken, picked ${chosen}`)
const port = chosen
console.log(`findFreePort: ${port}`)

/* ── adoption: an already-listening server must be adopted, not duplicated ─ */
if (await probeExistingServer('http://127.0.0.1:3011/health')) {
  const adopted = new McpServerProcess({
    exePath: EXE, workspaceRoot: 'E:\\ai\\dsh-plugins', port: 3011, autoStart: true
  })
  const snapshot = await adopted.start()
  assert.equal(snapshot.state, 'external')
  assert.equal(snapshot.owned, false)
  assert.equal(snapshot.healthUrl, 'http://127.0.0.1:3011/health')
  assert.equal(snapshot.mcpUrl, 'http://127.0.0.1:3011/mcp')
  assert.equal(snapshot.pid, undefined, 'an adopted process must not claim a pid')
  assert.match(snapshot.version, /^0\./, `unexpected version ${snapshot.version}`)
  // stop() must leave somebody else's process alone
  await adopted.stop()
  assert.ok(await probeExistingServer('http://127.0.0.1:3011/health'), 'stop() killed an adopted server')
  adopted.dispose()
  console.log('adopted an already-running server without spawning or killing it')
} else {
  console.log('no server on 3011; skipping the adoption check')
}

/* ── a real spawn: health, then a clean stop ─────────────────────────────── */
const managed = new McpServerProcess({
  exePath: EXE, workspaceRoot: os.tmpdir(), port, autoStart: true
})
const started = await managed.start()
assert.equal(started.state, 'running')
assert.equal(started.owned, true)
assert.ok(started.pid > 0, 'a spawned process must have a pid')
assert.equal(started.health.status, 'ok', `health check failed: ${JSON.stringify(started.health)}`)
assert.equal(started.health.authRequired, false)
assert.equal(started.baseUrl, `http://127.0.0.1:${port}`)
assert.equal(started.mcpUrl, `http://127.0.0.1:${port}/mcp`)
assert.equal(started.workspaceRoot, os.tmpdir())
assert.ok(started.uptimeMs >= 0)
console.log(`spawned pid ${started.pid} on port ${started.port} (v${started.version})`)
const describe = managed.describe()
await managed.stop()
assert.equal(managed.describe().state, 'stopped')
assert.ok(!(await probeExistingServer(describe.healthUrl)), 'still answering /health after stop()')
console.log('stop() really kills the process')

/* ── logs are captured so the settings page can show them ────────────────── */
const logged = new McpServerProcess({ exePath: EXE, workspaceRoot: os.tmpdir(), port, autoStart: false })
await assert.rejects(() => logged.start(), /autoStart is off/)
logged.dispose()
assert.equal(logged.describe().state, 'stopped')
console.log('autoStart=false with nothing listening rejects instead of spawning')

/* ── codex discovery ────────────────────────────────────────────────────── */
// An existing configured path must win over the default install...
const configured = path.join(os.tmpdir(), 'codex-fixture.exe')
fs.writeFileSync(configured, '')
assert.equal(resolveCodexPath(configured), configured, 'an existing configured path must win')
fs.rmSync(configured)
// ...a missing one must fall through instead of returning a dead path
const codexPath = resolveCodexPath(path.join(os.tmpdir(), 'nope', 'codex.exe'))
assert.ok(codexPath === undefined || codexPath.endsWith('codex.exe'), `unexpected codex path ${codexPath}`)
assert.notEqual(codexPath, path.join(os.tmpdir(), 'nope', 'codex.exe'))
process.env.CODEX_CLI_PATH = codexPath ?? ''
assert.equal(resolveCodexPath(''), codexPath, 'the env var is the fallback')
delete process.env.CODEX_CLI_PATH
const probe = await probeCodex(codexPath)
assert.equal(typeof probe.loggedIn, 'boolean')
console.log(`codex: path=${codexPath || '(none)'} loggedIn=${probe.loggedIn}${probe.version ? ` version=${probe.version}` : ''}`)

if (probe.available) {
  const servers = await listCodexMcpServers(codexPath)
  assert.ok(Array.isArray(servers))
  console.log(`codex reports ${servers.length} MCP server(s): ${servers.map((s) => s.name).join(', ')}`)
} else {
  console.log('codex not present; skipping the server-list check')
}

/* ── a missing exe must fail loudly, not hang ────────────────────────────── */
const broken = new McpServerProcess({
  exePath: path.join(os.tmpdir(), 'definitely-not-here.exe'),
  workspaceRoot: os.tmpdir(), port, autoStart: true
})
await assert.rejects(() => broken.start())
broken.dispose()
console.log('a missing executable rejects instead of hanging')

console.log('OK')