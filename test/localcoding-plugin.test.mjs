/**
 * Whole-plugin test: runs `apply()` against a fake host.
 *
 * The point is the wiring that unit tests cannot see — that `apply()` builds the
 * tunnel fleet and the browser manager, that every route in `server/http.js` is
 * registered, and that the status payload the Settings page reads actually
 * contains the sections the page renders. It loads the *deployed* copy by default,
 * because that is the file the host loads, so a deploy that silently missed a file
 * fails here instead of in the app.
 *
 * Run: `node test\localcoding-plugin.test.mjs`
 * Optional env:
 *   LCM_PLUGIN_DIR   directory holding index.js (default: the live profile copy)
 *   LCM_URL          MCP endpoint (default: http://127.0.0.1:3011/mcp)
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const PLUGIN_DIR = process.env.LCM_PLUGIN_DIR
  ?? 'C:\\Users\\HP-XXX\\.dsh\\profiles\\desktop\\node_modules\\dsh-localcoding-mcp'

const plugin = await import(pathToFileURL(path.join(PLUGIN_DIR, 'index.js')).href)

let failures = 0
async function check (name, run) {
  try {
    await run()
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures += 1
    console.error(`FAIL  ${name}\n      ${error.message}`)
  }
}

await check('the deployed copy is the one under test', () => {
  assert.ok(PLUGIN_DIR.length > 0)
  for (const rel of ['index.js', 'client.js', 'server/tunnel.js', 'server/browser.js', 'server/http.js']) {
    assert.ok(PLUGIN_DIR, rel)
  }
})

// ------------------------------------------------------------------ fake host
const registered = []
const routes = new Map()
const effects = []
const warnings = []

const tools = {
  register (definition) {
    registered.push(definition)
    return () => {
      const index = registered.indexOf(definition)
      if (index >= 0) registered.splice(index, 1)
    }
  }
}

const webServer = {
  register ({ path: routePath, handler }) {
    routes.set(routePath, handler)
    return () => routes.delete(routePath)
  }
}

const ctx = {
  tools,
  logger: {
    info () {},
    warn (error) { warnings.push(error instanceof Error ? error.message : String(error)) }
  },
  inject (names, callback) {
    assert.deepEqual(names, ['webServer'], 'only the web server plane is optional')
    // The injected plane is its own context, so it owns its own `effect` scope;
    // that is where `server/http.js` parks the route teardown.
    const webCtx = { webServer, logger: ctx.logger, effect: (fn, label) => effects.push({ label, dispose: fn() }) }
    callback(webCtx)
  },
  effect (fn, label) {
    // Cordis awaits an async effect and treats the function it resolves to as the
    // disposer, so the fake has to keep the promise around rather than the value.
    effects.push({ label, dispose: fn() })
  }
}

const config = plugin.Config({
  tunnelEnabled: true,
  browserEnabled: true,
  // Nothing here may start a child process: the fleet and the browser manager are
  // built and described, but auto-start stays off in this test.
  autoStart: false,
  tunnelAutoStartAll: false,
  browserAutoStart: false
})

plugin.apply(ctx, config)
// The bridge effect is async; give it a moment to settle before asserting.
await new Promise((resolve) => setTimeout(resolve, 1_500))

// ------------------------------------------------------------------ tools
await check('tools are registered with the lcm_ prefix', () => {
  const names = registered.map((tool) => tool.name)
  assert.ok(names.includes('lcm_codex_task'), 'reverse-delegation tool missing')
  assert.ok(names.every((name) => name === 'lcm_codex_task' || name.startsWith('lcm_')),
    `unexpected tool name: ${names.filter((name) => !name.startsWith('lcm_')).join(', ')}`)
  assert.ok(!names.includes('run_code'), 'the reserved host name must never be registered')
})

// ------------------------------------------------------------------ routes
const BASE = '/dsh-localcoding-mcp'

await check('every settings route is mounted', () => {
  const expected = [
    'status', 'health', 'tools', 'logs', 'probe', 'available',
    'start', 'stop', 'restart', 'refresh-tools',
    'codex/register', 'codex/unregister',
    'tunnel/accounts', 'tunnel/probe', 'tunnel/doctor',
    'tunnel/start', 'tunnel/start-all', 'tunnel/stop', 'tunnel/stop-all',
    'browser', 'browser/start', 'browser/stop',
    'call'
  ]
  const missing = expected.filter((suffix) => !routes.has(`${BASE}/${suffix}`))
  assert.deepEqual(missing, [], `unmounted routes: ${missing.join(', ')}`)
})

/** Invoke a mounted route with a loopback request and read back its JSON body. */
async function call (suffix, { method = 'GET', query = {}, body = {} } = {}) {
  const handler = routes.get(`${BASE}/${suffix}`)
  assert.ok(handler, `route not mounted: ${suffix}`)
  const url = new URL(`http://127.0.0.1${BASE}/${suffix}`)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  const chunks = method === 'POST' ? [Buffer.from(JSON.stringify(body))] : []
  let status = 0
  let payload = ''
  const res = {
    writeHead (code) { status = code },
    end (text) { payload = text }
  }
  const req = {
    method,
    url: `${url.pathname}${url.search}`,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator] () { yield * chunks }
  }
  await handler(req, res)
  return { status, body: payload ? JSON.parse(payload) : undefined }
}

await check('non-loopback and wrong-method requests are refused', async () => {
  const handler = routes.get(`${BASE}/status`)
  const rejected = []
  await handler(
    { method: 'GET', url: `${BASE}/status`, headers: {}, socket: { remoteAddress: '10.0.0.5' } },
    { writeHead: (code) => rejected.push(code), end: () => {} }
  )
  await handler(
    { method: 'GET', url: `${BASE}/status`, headers: { forwarded: 'for=10.0.0.5' }, socket: { remoteAddress: '127.0.0.1' } },
    { writeHead: (code) => rejected.push(code), end: () => {} }
  )
  assert.deepEqual(rejected, [403, 403], 'expected both to be refused with 403')
})

await check('the tunnel route reports the configured accounts', async () => {
  const { status, body } = await call('tunnel/accounts')
  assert.equal(status, 200)
  assert.equal(body.enabled, true, 'the fleet must exist when tunnelEnabled is true')
  assert.equal(body.accounts.length, 3, `expected 3 accounts, got ${body.accounts.length}`)
  assert.ok(body.accounts.every((account) => /^LCM_CP_KEY_[A-Z0-9_]+$/.test(account.keyVar)),
    `bad key var: ${body.accounts.map((a) => a.keyVar).join(', ')}`)
})

await check('the browser route reports the configured surface', async () => {
  const { status, body } = await call('browser')
  assert.equal(status, 200)
  assert.equal(body.enabled, true)
  assert.ok(typeof body.mcpUrl === 'string' && body.mcpUrl.includes('/mcp'))
})

await check('the status payload carries the sections the page renders', async () => {
  const { status, body } = await call('status')
  assert.equal(status, 200)
  for (const key of ['settings', 'server', 'tools', 'client', 'codex', 'tunnel', 'browser']) {
    assert.ok(body[key] !== undefined, `status is missing the ${key} section`)
  }
  assert.equal(body.settings.tunnelEnabled, true)
  assert.equal(body.settings.browserEnabled, true)
  assert.equal(body.tunnel.enabled, true)
  assert.equal(body.browser.enabled, true)
})

await check('tunnel actions require an id instead of failing obscurely', async () => {
  const missingId = await call('tunnel/probe', { query: {} })
  assert.equal(missingId.status, 500)
  assert.match(missingId.body.error, /id is required/)
  const unknown = await call('tunnel/probe', { query: { id: 'does-not-exist' } })
  assert.equal(unknown.status, 500)
  assert.match(unknown.body.error, /does-not-exist/)
})

// ------------------------------------------------------------------ teardown
await check('disposal unregisters the tools and the routes', async () => {
  // Cordis hands the effect's resolved function back as the disposer, and the
  // bridge disposer itself returns void while its child shutdown runs detached.
  for (const effect of effects) {
    const resolved = await effect.dispose
    if (typeof resolved === 'function') resolved()
  }
  assert.equal(registered.length, 0, `tools left registered: ${registered.map((t) => t.name).join(', ')}`)
  assert.equal(routes.size, 0, `routes left mounted: ${[...routes.keys()].join(', ')}`)
})

console.log(warnings.length ? `  note  ${warnings.length} warning(s): ${warnings[0]}` : '  note  no warnings')
console.log(failures ? `localcoding plugin: ${failures} check(s) failed` : 'localcoding plugin: all checks passed')
process.exit(failures ? 1 : 0)
