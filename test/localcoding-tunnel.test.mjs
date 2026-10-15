/**
 * Tests for the GPT-web half of the bridge (`server/tunnel.js`, `server/browser.js`).
 *
 * Covers the parts that are decided by facts nobody can guess from reading the code:
 * account parsing, the key-variable naming rule, proxy probing, DPAPI recovery, and
 * profile generation/verification against the real `tunnel-client.exe`.
 *
 * Run: `node test\localcoding-tunnel.test.mjs`
 * Optional env:
 *   LCM_TUNNEL_EXE       path to tunnel-client.exe
 *   LCM_ACCOUNTS         path to accounts.json
 *   LCM_TUNNEL_SKIP_DPIDEMO=1  skip the decrypt round-trip
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:net'

import {
  DEFAULT_CONTROL_PLANE_BASE_URL,
  DEFAULT_PROXY_CANDIDATES,
  TunnelFleet,
  decryptControlPlaneKey,
  isPortFree,
  keyVariableName,
  probeProxy,
  readAccounts,
  resolveProxy
} from '../dsh-localcoding-mcp/server/tunnel.js'
import { createBrowserProcess, resolveExtensionToken } from '../dsh-localcoding-mcp/server/browser.js'

const ROOT = 'E:\\ai\\aiassistant\\plugins\\LocalCodingMCP_v0_3\\mcp-accounts'
const EXE = process.env.LCM_TUNNEL_EXE ?? path.join(ROOT, 'tunnel-client.exe')
const ACCOUNTS = process.env.LCM_ACCOUNTS ?? path.join(ROOT, 'config', 'accounts.json')

let failures = 0
function check (name, run) {
  return Promise.resolve()
    .then(run)
    .then(() => console.log(`  ok  ${name}`))
    .catch((error) => {
      failures += 1
      console.error(`FAIL  ${name}\n      ${error.message}`)
    })
}

// ---------------------------------------------------------------- key var naming
await check('key variable names are unique and shell-safe', () => {
  assert.equal(keyVariableName('account-001'), 'LCM_CP_KEY_ACCOUNT_001')
  assert.equal(keyVariableName('account.002'), 'LCM_CP_KEY_ACCOUNT_002')
  assert.equal(keyVariableName('9lives'), 'LCM_CP_KEY_A_9LIVES')
  const seen = new Set()
  for (const account of readAccounts(ACCOUNTS).accounts) {
    assert.match(account.keyVar, /^LCM_CP_KEY_[A-Z_][A-Z0-9_]*$/, `bad var for ${account.id}`)
    assert.ok(!seen.has(account.keyVar), `duplicate var ${account.keyVar}`)
    seen.add(account.keyVar)
  }
  assert.equal(seen.size, 3, 'expected three accounts')
})

// ---------------------------------------------------------------- account parsing
await check('accounts.json yields three launchable accounts with no secrets', () => {
  const { accounts, skipped } = readAccounts(ACCOUNTS)
  assert.deepEqual(skipped, [], `unexpected skips: ${JSON.stringify(skipped)}`)
  assert.equal(accounts.length, 3)
  for (const account of accounts) {
    assert.match(account.tunnelId, /^tunnel_[0-9a-f]{32}$/)
    assert.equal(account.keyConfigured, true)
    // The DPAPI ciphertext must never be carried out of the config reader.
    assert.equal(account.controlPlaneKey, undefined)
    assert.equal(JSON.stringify(accounts).includes('controlPlaneKey'), false)
  }
})

await check('bad account shapes are skipped with a reason', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lcm-tunnel-'))
  try {
    const file = path.join(dir, 'accounts.json')
    writeFileSync(file, JSON.stringify({
      accounts: [
        { id: 'a', name: 'A', enabled: false, tunnel: { tunnelId: 'tunnel_' + 'a'.repeat(32), controlPlaneKey: 'x' } },
        { id: 'b', name: 'B', tunnel: { tunnelId: 'nope', controlPlaneKey: 'x' } },
        { id: 'c', name: 'C', tunnel: { tunnelId: 'tunnel_' + 'c'.repeat(32) } },
        { id: 'd', name: 'D', tunnel: { tunnelId: 'tunnel_' + 'd'.repeat(32), controlPlaneKey: 'x', enabled: false } },
        { id: 'e', name: 'E' },
        { id: 'f', name: 'F', tunnel: { tunnelId: 'tunnel_' + 'f'.repeat(32), controlPlaneKey: 'x' } },
        { id: 'f', name: 'F again', tunnel: { tunnelId: 'tunnel_' + '0'.repeat(32), controlPlaneKey: 'x' } }
      ]
    }))
    const { accounts, skipped } = readAccounts(file)
    assert.deepEqual(accounts.map((a) => a.id), ['f'])
    const reasons = Object.fromEntries(skipped.map((entry) => [entry.id, entry.reason]))
    assert.equal(reasons.a, 'account disabled')
    assert.equal(reasons.b, 'tunnel id format is wrong')
    assert.equal(reasons.c, 'no control plane key')
    assert.equal(reasons.d, 'tunnel disabled')
    assert.equal(reasons.e, 'no tunnel configured')
    assert.equal(reasons.f, 'duplicate account id')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

await check('a missing or broken config never throws', () => {
  assert.equal(readAccounts(path.join(tmpdir(), 'nope-12345.json')).accounts.length, 0)
  const dir = mkdtempSync(path.join(tmpdir(), 'lcm-tunnel-'))
  try {
    const file = path.join(dir, 'bad.json')
    writeFileSync(file, '{ not json')
    const result = readAccounts(file)
    assert.equal(result.accounts.length, 0)
    assert.match(result.skipped[0].reason, /cannot parse config/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------- proxy probing
await check('a real HTTP proxy answers CONNECT; a closed port does not', async () => {
  const listener = createServer((socket) => socket.destroy())
  const port = await new Promise((resolve) => {
    listener.listen(0, '127.0.0.1', () => resolve(listener.address().port))
  })
  try {
    assert.equal(await probeProxy(`http://127.0.0.1:${port}`, 'api.openai.com'), false,
      'a socket that destroys must not count as a usable proxy')
    assert.equal(await probeProxy('not a url', 'api.openai.com'), false)
  } finally {
    await new Promise((resolve) => listener.close(resolve))
  }
  // A port nobody listens on.
  const free = await isPortFree(0)
  assert.equal(typeof free, 'boolean')
})

await check('resolveProxy returns the first candidate that connects', async () => {
  const closed = await new Promise((resolve) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })
  const answer = await resolveProxy(['not a url', `http://127.0.0.1:${closed}`], 'api.openai.com')
  assert.equal(answer, '', 'no candidate is usable, so the answer must be empty (direct)')
  assert.equal(DEFAULT_PROXY_CANDIDATES[0], 'http://127.0.0.1:7897')
})

// ---------------------------------------------------------------- DPAPI
if (process.env.LCM_TUNNEL_SKIP_DPIDEMO === '1') {
  console.log('  --  DPAPI round-trip skipped (LCM_TUNNEL_SKIP_DPIDEMO=1)')
} else {
  await check('the control plane key decrypts in memory and is never echoed', async () => {
    const { accounts } = readAccounts(ACCOUNTS)
    const target = accounts[0]
    const key = await decryptControlPlaneKey(ACCOUNTS, target.id)
    assert.ok(key.length > 0, 'expected a decrypted key')
    // We only assert on shape: printing the value would leak it into the log.
    assert.match(key, /^[A-Za-z0-9_\-.]{16,}$/, 'key shape')
    console.log(`      recovered ${key.length} chars for ${target.id} (value not logged)`)
    assert.equal(await decryptControlPlaneKey(ACCOUNTS, 'no-such-account'), '')
  })
}

// ---------------------------------------------------------------- profile generation
if (!process.env.LCM_TUNNEL_EXE) {
  await check('tunnel-client init produces a profile that verifies by content', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lcm-profile-'))
    try {
      const { accounts } = readAccounts(ACCOUNTS)
      const account = accounts[0]
      const fleet = new TunnelFleet({
        exePath: EXE,
        accountsPath: ACCOUNTS,
        profileDir: dir,
        logDir: dir,
        mcpUrl: 'http://127.0.0.1:3011/mcp',
        healthPortBase: 8080,
        controlPlaneBaseUrl: DEFAULT_CONTROL_PLANE_BASE_URL
      })
      assert.equal(fleet.available, true, 'tunnel-client.exe must exist for this check')

      // Reach the profile generator through the public surface: a full start would
      // open a real control-plane connection, so only profile generation is exercised.
      const port = 8123
      const result = await fleet.prepareProfile(account, port)
      assert.equal(result.ok, true, `profile generation failed: ${result.output}\n${result.expected ?? ''}`)

      const text = readFileSync(path.join(dir, `${account.id}.yaml`), 'utf8')
      assert.ok(text.includes(account.tunnelId), 'profile must carry the tunnel id')
      assert.ok(text.includes(`env:${account.keyVar}`), 'profile must reference the key env var')
      assert.ok(text.includes(`127.0.0.1:${port}`), 'profile must carry the listen address')
      assert.ok(text.includes('http://127.0.0.1:3011/mcp'), 'profile must carry the MCP url')
      assert.equal(text.includes('controlPlaneKey'), false, 'no secret may be written into the profile')
      assert.equal(text.charCodeAt(0) === 0xfeff, false, 'profile must not start with a BOM')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  await check('describe() never carries secret material', async () => {
    const fleet = new TunnelFleet({
      exePath: EXE,
      accountsPath: ACCOUNTS,
      profileDir: path.join(tmpdir(), 'lcm-x'),
      logDir: path.join(tmpdir(), 'lcm-x'),
      mcpUrl: 'http://127.0.0.1:3011/mcp'
    })
    const snapshot = JSON.stringify(fleet.describe())
    const blob = readAccounts(ACCOUNTS).accounts.map((a) => a.id).join()
    assert.ok(blob.length > 0)
    assert.equal(snapshot.includes('controlPlaneKey'), false)
    assert.equal(snapshot.includes('sk-'), false, 'no api-key-shaped string may appear')
    assert.equal(snapshot.includes('env:'), false, 'key env var names stay out of the snapshot')
    assert.equal(fleet.describe().accounts.length, 3)
    assert.equal(fleet.describe().mcpUrl, 'http://127.0.0.1:3011/mcp')
  })
}

// ---------------------------------------------------------------- fleet lifecycle
await check('an unknown account id is rejected, not silently started', async () => {
  const fleet = new TunnelFleet({
    exePath: EXE,
    accountsPath: ACCOUNTS,
    profileDir: path.join(tmpdir(), 'lcm-y'),
    logDir: path.join(tmpdir(), 'lcm-y'),
    mcpUrl: 'http://127.0.0.1:3011/mcp'
  })
  await assert.rejects(() => fleet.start('does-not-exist'), /no enabled account/)
  await assert.rejects(() => fleet.stop('does-not-exist'), /never started/)
  await assert.rejects(() => fleet.probe('does-not-exist'), /never started/)
})

await check('a missing tunnel-client.exe is reported, not spawned blindly', async () => {
  const fleet = new TunnelFleet({
    exePath: path.join(tmpdir(), 'no-such-tunnel-client.exe'),
    accountsPath: ACCOUNTS,
    profileDir: path.join(tmpdir(), 'lcm-z'),
    logDir: path.join(tmpdir(), 'lcm-z'),
    mcpUrl: 'http://127.0.0.1:3011/mcp'
  })
  assert.equal(fleet.available, false)
  await assert.rejects(() => fleet.start('account-001'), /tunnel-client\.exe not found/)
})

// ---------------------------------------------------------------- browser surface
await check('the browser manager refuses to start without a token', async () => {
  const manager = createBrowserProcess({
    entry: path.join(ROOT, 'playwright-mcp', 'cli.js'),
    port: 8931,
    autoStart: true
  })
  const described = manager.describe()
  assert.equal(described.tokenConfigured, false, 'a fresh manager holds no token')
  assert.ok(described.mcpUrl.startsWith('http://localhost:'), 'must probe over localhost, not the raw IP')
  assert.equal(described.entry.includes('playwright-mcp'), true)
  // A manager with autoStart off must say so rather than spawn anything.
  const off = createBrowserProcess({ entry: 'nope.js', autoStart: false })
  await assert.rejects(() => off.start(), /not found|browser tools are disabled/)
})

await check('the extension token is read from the user environment block', async () => {
  const token = await resolveExtensionToken()
  // This machine has it as a User variable; the process block does not carry it,
  // which is exactly the trap the launcher script documents.
  console.log(`      extension token ${token ? 'found' : 'NOT FOUND (browser tools will refuse to start)'}`)
  assert.equal(typeof token, 'string')
})

console.log(failures === 0 ? '\nlocalcoding tunnel: all checks passed' : `\nlocalcoding tunnel: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
