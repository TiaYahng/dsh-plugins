/**
 * Tests for the native tool surface and the model bridge.
 *
 * Two things are being proven here, and they are the two claims the user's
 * architecture change rests on:
 *
 *   1. The MCP tool surface really is native now — every tool registers through a
 *      plain `tools.register`, no child process and no port are involved.
 *   2. The `/v1` routes really do translate an OpenAI request into this app's own
 *      model access, including streaming, without leaking a proxy off-machine.
 *
 * Run: `node test\localcoding-native.test.mjs`
 * Optional env:
 *   LCM_PLUGIN_DIR   directory holding index.js (default: the repo source)
 *   LCM_WORKSPACE    workspace root used for the tool fixtures (default: a temp dir)
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn as childProcessSpawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const PLUGIN_DIR = process.env.LCM_PLUGIN_DIR ?? path.join(import.meta.dirname, '..', 'dsh-localcoding-mcp')

const native = await import(pathToFileURL(path.join(PLUGIN_DIR, 'server', 'native', 'index.js')).href)
const bridge = await import(pathToFileURL(path.join(PLUGIN_DIR, 'server', 'model-bridge.js')).href)
const routes = await import(pathToFileURL(path.join(PLUGIN_DIR, 'server', 'model-routes.js')).href)

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

// A throwaway workspace so the file tools are exercised against real files.
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'lcm-native-'))
fs.writeFileSync(path.join(workspace, 'hello.txt'), 'first line\nsecond line\n', 'utf8')
fs.mkdirSync(path.join(workspace, 'sub'), { recursive: true })
fs.writeFileSync(path.join(workspace, 'sub', 'code.js'), 'export function greet (name) {\n  return name\n}\n', 'utf8')
fs.writeFileSync(path.join(workspace, 'AGENTS.md'), '# rules\nbe careful\n', 'utf8')

// ---------------------------------------------------------------- the surface
const registered = []
const tools = {
  register (definition) {
    assert.ok(definition.name, 'every tool needs a name')
    assert.ok(definition.output?.schema, `${definition.name} needs output.schema`)
    assert.equal(typeof definition.output.render, 'function', `${definition.name} needs output.render`)
    assert.equal(typeof definition.execute, 'function', `${definition.name} needs execute`)
    registered.push(definition)
    return () => {
      const index = registered.indexOf(definition)
      if (index >= 0) registered.splice(index, 1)
    }
  }
}

const surface = native.createNativeSurface({
  workspaceRoot: workspace,
  tools,
  logger: { warn () {}, info () {} }
})

/** Look one tool up by name. */
const tool = (name) => {
  const found = registered.find((entry) => entry.name === name)
  assert.ok(found, `tool not registered: ${name}`)
  return found
}

/** Run a tool the way the host does: bare value out, then render. */
const run = async (name, args) => {
  const definition = tool(name)
  const value = await definition.execute(args ?? {}, { signal: undefined })
  return { value, text: definition.output.render(args ?? {}, value).map((block) => block.text ?? '').join('\n') }
}

await check('the surface is native: no process, no port, no MCP client', () => {
  assert.ok(registered.length >= 25, `expected a full surface, got ${registered.length} tools`)
  assert.equal(surface.failed.length, 0, `tools failed to register: ${JSON.stringify(surface.failed)}`)
  assert.equal(surface.describe().source, 'native')
  assert.equal(surface.describe().toolCount, registered.length)
  // The old bridge's tell-tale: a tool whose description names the .NET server.
  const leaked = registered.filter((entry) => /LocalCodingMCP\.exe|http:\/\/127\.0\.0\.1:3011/.test(entry.description))
  assert.deepEqual(leaked.map((entry) => entry.name), [], 'a tool still points at the old server')
})

await check('every tool name is prefixed and schemas are in the host subset', () => {
  const allowed = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const',
    'description', 'title', 'default', 'examples'])
  for (const definition of registered) {
    assert.ok(definition.name.startsWith('lcm_'), `${definition.name} is missing the lcm_ prefix`)
    assert.notEqual(definition.name, 'run_code', 'the reserved host name must never be registered')
    assert.equal(definition.parameters.type, 'object', `${definition.name} parameters must be an object schema`)
    if (definition.parameters.required) {
      for (const key of definition.parameters.required) {
        assert.ok(definition.parameters.properties?.[key], `${definition.name}: required "${key}" is not in properties`)
      }
    }
    const walk = (node, where) => {
      if (node === null || typeof node !== 'object') return
      for (const key of Object.keys(node)) {
        assert.ok(allowed.has(key), `${definition.name}: unsupported JSON schema keyword "${key}" at ${where}`)
      }
      if (node.properties) for (const [key, child] of Object.entries(node.properties)) walk(child, `${where}.${key}`)
      if (node.items) walk(node.items, `${where}[]`)
    }
    walk(definition.output.schema, 'output')
  }
})

await check('names are unique across the whole surface', () => {
  const seen = new Set()
  for (const definition of registered) {
    assert.ok(!seen.has(definition.name), `duplicate tool name: ${definition.name}`)
    seen.add(definition.name)
  }
})

// ---------------------------------------------------------------- path safety
await check('a path outside the workspace is refused', async () => {
  const escapees = ['../../etc/passwd', '..\\..\\Windows\\System32', path.join(os.tmpdir(), 'elsewhere.txt')]
  for (const candidate of escapees) {
    await assert.rejects(
      () => tool('lcm_read_file').execute({ path: candidate }, {}),
      /outside the workspace root|does not exist/,
      `expected refusal for ${candidate}`
    )
  }
  await assert.rejects(
    () => tool('lcm_write_file').execute({ path: '../escape.txt', content: 'x' }, {}),
    /outside the workspace root/
  )
  assert.ok(!fs.existsSync(path.join(path.dirname(workspace), 'escape.txt')), 'the escape file must not exist')
})

await check('the workspace root itself cannot be deleted', async () => {
  await assert.rejects(
    () => tool('lcm_delete_directory').execute({ path: '.' }, {}),
    /refusing to delete the workspace root/
  )
  assert.ok(fs.existsSync(workspace), 'the workspace must still exist')
})

// ---------------------------------------------------------------- file tools
await check('read, write and list work and render real text', async () => {
  const read = await run('lcm_read_file', { path: 'hello.txt' })
  assert.equal(read.value.totalLines, 3, 'split on \\n gives a trailing empty line')
  assert.match(read.text, /1\tfirst line/)
  assert.match(read.text, /2\tsecond line/)

  const write = await run('lcm_write_file', { path: 'sub/new.txt', content: 'written' })
  assert.equal(write.value.created, true)
  assert.equal(fs.readFileSync(path.join(workspace, 'sub', 'new.txt'), 'utf8'), 'written')

  const listing = await run('lcm_list_files', { path: 'sub' })
  assert.ok(listing.value.count >= 2)
  assert.match(listing.text, /code\.js/)
})

await check('an ambiguous patch refuses instead of editing the wrong place', async () => {
  fs.writeFileSync(path.join(workspace, 'dup.txt'), 'same\nsame\n', 'utf8')
  await assert.rejects(
    () => tool('lcm_apply_patch').execute({ path: 'dup.txt', oldText: 'same', newText: 'other' }, {}),
    /appears 2 times/
  )
  const applied = await run('lcm_apply_patch', { path: 'dup.txt', oldText: 'same', newText: 'other', replaceAll: true })
  assert.equal(applied.value.replacements, 2)
  assert.equal(fs.readFileSync(path.join(workspace, 'dup.txt'), 'utf8'), 'other\nother\n')
})

await check('a missing match says so instead of writing nothing', async () => {
  await assert.rejects(
    () => tool('lcm_apply_patch').execute({ path: 'hello.txt', oldText: 'not in the file', newText: 'x' }, {}),
    /was not found in the file/
  )
})

await check('binary files are refused by the text reader', async () => {
  fs.writeFileSync(path.join(workspace, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0xff]))
  await assert.rejects(
    () => tool('lcm_read_file').execute({ path: 'blob.bin' }, {}),
    /does not look like UTF-8 text/
  )
})

// ---------------------------------------------------------------- the journal
await check('a write can be undone, restoring the previous bytes', async () => {
  const before = fs.readFileSync(path.join(workspace, 'hello.txt'), 'utf8')
  await run('lcm_write_file', { path: 'hello.txt', content: 'REPLACED' })
  assert.equal(fs.readFileSync(path.join(workspace, 'hello.txt'), 'utf8'), 'REPLACED')
  const undone = await run('lcm_undo_last_change', {})
  assert.equal(undone.value.undone, 1)
  assert.equal(fs.readFileSync(path.join(workspace, 'hello.txt'), 'utf8'), before)
})

await check('undoing a patch restores the pre-patch text', async () => {
  fs.writeFileSync(path.join(workspace, 'patchme.txt'), 'alpha\nbeta\n', 'utf8')
  const before = fs.readFileSync(path.join(workspace, 'patchme.txt'), 'utf8')
  await run('lcm_apply_patch', { path: 'patchme.txt', oldText: 'beta', newText: 'gamma' })
  assert.equal(fs.readFileSync(path.join(workspace, 'patchme.txt'), 'utf8'), 'alpha\ngamma\n')
  await run('lcm_undo_last_change', {})
  assert.equal(fs.readFileSync(path.join(workspace, 'patchme.txt'), 'utf8'), before)
})

await check('deleting a file is reversible and the journal says what happened', async () => {
  fs.writeFileSync(path.join(workspace, 'doomed.txt'), 'keep me', 'utf8')
  await run('lcm_delete_file', { path: 'doomed.txt' })
  assert.ok(!fs.existsSync(path.join(workspace, 'doomed.txt')))
  await run('lcm_undo_last_change', {})
  assert.equal(fs.readFileSync(path.join(workspace, 'doomed.txt'), 'utf8'), 'keep me')
  const listed = await run('lcm_list_recent_changes', { count: 5 })
  assert.ok(Array.isArray(listed.value.entries))
})

await check('a removed directory tree is reported as not reversible', async () => {
  fs.mkdirSync(path.join(workspace, 'tree', 'inner'), { recursive: true })
  fs.writeFileSync(path.join(workspace, 'tree', 'inner', 'f.txt'), 'x', 'utf8')
  await run('lcm_delete_directory', { path: 'tree' })
  assert.ok(!fs.existsSync(path.join(workspace, 'tree')))
  const entries = surface.journal.list(1)
  assert.equal(entries[0].reversible, false, 'a directory tree must not claim to be recoverable')
})

// ---------------------------------------------------------------- search
await check('search finds a match and reports what it scanned', async () => {
  const result = await run('lcm_search_code', { query: 'greet', path: '.', literal: true })
  assert.ok(result.value.count >= 1, 'expected at least one match')
  assert.match(result.text, /code\.js:\d+/)
  assert.ok(result.value.filesScanned > 0)
})

await check('an invalid regular expression is reported as such', async () => {
  await assert.rejects(
    () => tool('lcm_search_code').execute({ query: '([unclosed' }, {}),
    /invalid regular expression/
  )
})

await check('no matches is a result, not an error', async () => {
  const result = await run('lcm_search_code', { query: 'zzz-not-present-zzz', literal: true })
  assert.equal(result.value.count, 0)
  assert.match(result.text, /No matches/)
})

await check('find_definitions locates a declaration and admits its heuristic', async () => {
  const found = await run('lcm_find_definitions', { symbol: 'greet', language: 'javascript' })
  assert.equal(found.value.count, 1)
  assert.match(found.text, /code\.js/)
  const missing = await run('lcm_find_definitions', { symbol: 'nope-not-here' })
  assert.equal(missing.value.count, 0)
  assert.match(missing.text, /declaration-pattern search/)
})

// ---------------------------------------------------------------- workspace
await check('workspace info and rules read the real root', async () => {
  const info = await run('lcm_get_workspace_info', {})
  assert.equal(info.value.exists, true)
  assert.ok(info.value.files >= 4, `expected several files, got ${info.value.files}`)
  const rules = await run('lcm_get_agent_rules', {})
  assert.deepEqual(rules.value.found, ['AGENTS.md'])
  assert.match(rules.text, /be careful/)
  const context = await run('lcm_get_agent_context', {})
  assert.match(context.text, /AGENTS\.md/)
})

// ---------------------------------------------------------------- processes
await check('a spawned process is tracked, readable and killable', async () => {
  const node = process.execPath
  const spawned = await run('lcm_spawn_process', {
    executable: node,
    arguments: ['-e', 'console.log("from the child"); setTimeout(() => {}, 30000)'],
    waitSeconds: 1.5
  })
  assert.match(spawned.value.sessionId, /^proc-\d+$/)
  assert.match(spawned.text, /from the child/)
  const list = await run('lcm_list_processes', {})
  assert.ok(list.value.count >= 1)
  const killed = await run('lcm_kill_process', { sessionId: spawned.value.sessionId })
  assert.equal(killed.value.wasRunning, true)
})

await check('a command that fails reports its exit code instead of throwing', async () => {
  const result = await run('lcm_run_native_command', {
    executable: process.execPath,
    arguments: ['-e', 'process.exit(3)'],
    timeoutSeconds: 20
  })
  assert.equal(result.value.ok, false)
  assert.equal(result.value.exitCode, 3)
})

await check('a timeout is reported as a timeout, with the tree killed', async () => {
  const started = Date.now()
  const result = await run('lcm_run_native_command', {
    executable: process.execPath,
    arguments: ['-e', 'setTimeout(() => {}, 60000)'],
    timeoutSeconds: 5
  })
  const elapsed = Date.now() - started
  assert.equal(result.value.timedOut, true)
  // The whole point of killTree: settle near the budget, not when the child feels
  // like exiting. A regression here took 105 s for a 20 s budget once already.
  assert.ok(elapsed < 30_000, `timeout took ${elapsed} ms, which means the tree was not killed`)
})

await check('a repository the workspace does not own is refused for writes', async () => {
  // The fixture lives under %TEMP%, which on this machine is inside the user's
  // home repository (C:\Users\HP-XXX\.git). Reading is allowed and must disclose
  // where the repo really is; a commit must refuse, because `git add -A` stages
  // the whole repository and would sweep unrelated files into the commit.
  const status = await run('lcm_git_status', {})
  assert.ok(status.value.branch.length > 0, 'git_status must report a branch')
  assert.match(status.text, /Repository root is .*(not the workspace root)/)

  await assert.rejects(
    () => tool('lcm_git_commit').execute({ message: 'should not happen' }, {}),
    /is not its own repository/
  )
  await assert.rejects(
    () => tool('lcm_git_restore_file').execute({ path: 'hello.txt' }, {}),
    /is not its own repository/
  )
})

await check('git tools work when the workspace owns its repository', async () => {
  const ownRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcm-repo-'))
  const ownRegistered = []
  try {
    // autocrlf would rewrite line endings on restore and make the assertion about
    // content rather than about git's configuration.
    for (const args of [['init', '-q'], ['config', 'core.autocrlf', 'false'], ['config', 'user.email', 'test@example.com'], ['config', 'user.name', 'Test']]) {
      const child = childProcessSpawn('git', args, { cwd: ownRepoDir, stdio: 'ignore' })
      await new Promise((resolve) => child.on('exit', resolve))
    }
    fs.writeFileSync(path.join(ownRepoDir, 'a.txt'), 'one\n', 'utf8')

    const own = native.createNativeSurface({
      workspaceRoot: ownRepoDir,
      tools: { register: (definition) => { ownRegistered.push(definition); return () => {} } },
      logger: { warn () {}, info () {} }
    })
    const byName = (name) => {
      const found = ownRegistered.find((entry) => entry.name === name)
      assert.ok(found, `tool not registered: ${name}`)
      return found
    }

    const status = await byName('lcm_git_status').execute({}, {})
    assert.equal(status.clean, false, 'the untracked file makes the tree dirty')
    const committed = await byName('lcm_git_commit').execute({ message: 'first' }, {})
    assert.equal(committed.files, 1)
    assert.ok(committed.hash.length >= 4)

    const clean = await byName('lcm_git_status').execute({}, {})
    assert.equal(clean.clean, true)

    fs.writeFileSync(path.join(ownRepoDir, 'a.txt'), 'two\n', 'utf8')
    await byName('lcm_git_restore_file').execute({ path: 'a.txt' }, {})
    assert.equal(fs.readFileSync(path.join(ownRepoDir, 'a.txt'), 'utf8'), 'one\n')

    // `execute` returns the bare value; the host does the wrapping, so there is no
    // `.value` here — that mistake is exactly what made this assertion fail first.
    const log = await byName('lcm_git_log').execute({ count: 5 }, {})
    assert.equal(log.count, 1)
    assert.equal(log.commits[0].subject, 'first')

    own.dispose()
  } finally {
    fs.rmSync(ownRepoDir, { recursive: true, force: true, maxRetries: 3 })
  }
})

await check('committing with nothing staged refuses instead of making an empty commit', async () => {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcm-empty-'))
  const emptyRegistered = []
  try {
    const child = childProcessSpawn('git', ['init', '-q'], { cwd: repoDir, stdio: 'ignore' })
    await new Promise((resolve) => child.on('exit', resolve))
    for (const args of [['config', 'user.email', 'test@example.com'], ['config', 'user.name', 'Test']]) {
      const configure = childProcessSpawn('git', args, { cwd: repoDir, stdio: 'ignore' })
      await new Promise((resolve) => configure.on('exit', resolve))
    }
    const emptySurface = native.createNativeSurface({
      workspaceRoot: repoDir,
      tools: { register: (definition) => { emptyRegistered.push(definition); return () => {} } },
      logger: { warn () {}, info () {} }
    })
    const commit = emptyRegistered.find((entry) => entry.name === 'lcm_git_commit')
    await assert.rejects(() => commit.execute({ message: 'nothing here' }, {}), /nothing to commit/)
    emptySurface.dispose()
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true, maxRetries: 3 })
  }
})

// ---------------------------------------------------------------- disposal
await check('disposal unregisters every tool', async () => {
  const before = registered.length
  assert.ok(before > 0)
  surface.dispose()
  assert.equal(registered.length, 0, `tools left registered: ${registered.map((entry) => entry.name).join(', ')}`)
  // Nothing should be left running either.
  const list = surface.registry.list()
  assert.equal(list.filter((session) => session.running).length, 0, 'a child process outlived the surface')
})

// ---------------------------------------------------------------- model bridge
await check('OpenAI messages become host messages with the right shapes', () => {
  const messages = bridge.toHostMessages([
    { role: 'system', content: 'you are a helper' },
    { role: 'user', content: 'hello' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":"a.txt"}' } }]
    },
    { role: 'tool', tool_call_id: 'call_1', content: 'file contents' }
  ])
  assert.equal(messages.length, 3, 'system is hoisted out of the message list')
  assert.equal(messages[0].role, 'user')
  assert.deepEqual(messages[0].content, [{ type: 'text', text: 'hello' }])
  assert.equal(messages[1].content[0].type, 'tool-call')
  // The host declares this as a JSON string; passing an object would break adapters.
  assert.equal(messages[1].content[0].arguments, '{"path":"a.txt"}')
  assert.equal(messages[2].role, 'tool')
  assert.equal(messages[2].toolCallId, 'call_1')
  assert.deepEqual(messages[2].source, { kind: 'tool', callId: 'call_1' })
  for (const message of messages) assert.ok(message.id, 'every host message needs an id')
  assert.equal(bridge.toSystemPrompt([{ role: 'system', content: 'you are a helper' }]), 'you are a helper')
})

await check('the model proxy refuses anything not from this machine', () => {
  assert.equal(bridge.isTrustedModelRequest({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), true)
  assert.equal(bridge.isTrustedModelRequest({ headers: {}, socket: { remoteAddress: '::1' } }), true)
  assert.equal(bridge.isTrustedModelRequest({ headers: {}, socket: { remoteAddress: '10.0.0.4' } }), false)
  assert.equal(bridge.isTrustedModelRequest({ headers: { forwarded: 'for=10.0.0.4' }, socket: { remoteAddress: '127.0.0.1' } }), false)
  assert.equal(bridge.isTrustedModelRequest({ headers: { 'x-forwarded-for': '10.0.0.4' }, socket: { remoteAddress: '127.0.0.1' } }), false)
})

await check('host chunks stream out as OpenAI SSE frames', async () => {
  async function * chunks () {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Hel' }
    yield { type: 'text-delta', index: 0, text: 'lo' }
    yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } }
    yield { type: 'finish', reason: 'stop' }
  }
  const frames = []
  for await (const frame of bridge.toOpenAiStream(chunks(), { id: 'chatcmpl-x', model: 'm', created: 1, includeUsage: true })) {
    frames.push(frame)
  }
  const parsed = frames.filter((frame) => !frame.includes('[DONE]')).map((frame) => JSON.parse(frame.slice(6)))
  assert.equal(parsed[0].choices[0].delta.role, 'assistant')
  const text = parsed.map((entry) => entry.choices?.[0]?.delta?.content ?? '').join('')
  assert.equal(text, 'Hello')
  // The finish frame is the last one carrying choices; the usage frame after it has
  // an empty choices array by design, so searching for the reason is the right way
  // to assert on it rather than indexing from the end.
  const finishFrame = parsed.filter((entry) => entry.choices?.[0]?.finish_reason).at(-1)
  assert.equal(finishFrame.choices[0].finish_reason, 'stop')
  const usageFrame = parsed.find((entry) => entry.usage)
  assert.equal(usageFrame.usage.total_tokens, 7)
  assert.ok(frames.at(-1).includes('[DONE]'))
})

await check('a non-streaming request assembles one complete response', async () => {
  async function * chunks () {
    yield { type: 'text-delta', index: 0, text: 'full ' }
    yield { type: 'text-delta', index: 0, text: 'answer' }
    yield { type: 'finish', reason: 'stop' }
  }
  const completion = await bridge.collectCompletion(chunks(), { id: 'chatcmpl-y', model: 'm', created: 1 })
  assert.equal(completion.object, 'chat.completion')
  assert.equal(completion.choices[0].message.content, 'full answer')
  assert.equal(completion.choices[0].finish_reason, 'stop')
})

await check('tool calls survive the round trip in both directions', async () => {
  async function * chunks () {
    yield { type: 'tool-call-delta', index: 0, id: 'call_9', name: 'lcm_read_file', argumentsDelta: '{"path":' }
    yield { type: 'tool-call-delta', index: 0, id: 'call_9', argumentsDelta: '"a.txt"}' }
    yield { type: 'finish', reason: 'tool-calls' }
  }
  const completion = await bridge.collectCompletion(chunks(), { id: 'chatcmpl-z', model: 'm', created: 1 })
  const call = completion.choices[0].message.tool_calls[0]
  assert.equal(call.id, 'call_9')
  assert.equal(call.function.name, 'lcm_read_file')
  assert.equal(call.function.arguments, '{"path":"a.txt"}')
  assert.equal(completion.choices[0].finish_reason, 'tool_calls')
})

// ---------------------------------------------------------------- the routes
await check('the routes translate a request into one llm call', async () => {
  const routes_ = new Map()
  const effects = []
  const webCtx = {
    webServer: { register: ({ path: routePath, handler }) => { routes_.set(routePath, handler); return () => routes_.delete(routePath) } },
    logger: { warn () {} },
    effect: (fn, label) => effects.push({ label, dispose: fn() })
  }

  const calls = []
  const llm = {
    listProviders: () => [{ id: 'deepseek' }],
    async listModels () { return [{ id: 'deepseek-v4-pro' }] },
    async prepareCall (config) {
      return {
        config,
        stream: (options) => {
          calls.push(options)
          return (async function * () {
            yield { type: 'text-delta', index: 0, text: 'bridged' }
            yield { type: 'finish', reason: 'stop' }
          })()
        }
      }
    }
  }

  routes.registerModelRoutes(webCtx, {
    llmProvider: () => llm,
    configProvider: () => ({ modelProvider: 'deepseek', modelId: 'deepseek-v4-pro' })
  })

  for (const expected of ['/v1', '/v1/models', '/v1/chat/completions']) {
    assert.ok(routes_.has(expected), `route not mounted: ${expected}`)
  }

  const invoke = async (routePath, { method = 'GET', body, address = '127.0.0.1', headers = {} } = {}) => {
    const handler = routes_.get(routePath)
    let status = 0
    let payload = ''
    const res = {
      headersSent: false,
      writableEnded: false,
      writeHead (code) { status = code; this.headersSent = true },
      write (chunk) { payload += chunk },
      end (chunk) { if (chunk) payload += chunk; this.writableEnded = true },
      on () {}, off () {}
    }
    const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
    const req = {
      method,
      url: routePath,
      headers,
      socket: { remoteAddress: address },
      async *[Symbol.asyncIterator] () { yield * chunks }
    }
    await handler(req, res)
    // The handlers start an async body and return; wait for it to finish writing.
    for (let attempt = 0; attempt < 100 && !res.writableEnded; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    return { status, payload }
  }

  const models = await invoke('/v1/models')
  assert.equal(models.status, 200)
  assert.equal(JSON.parse(models.payload).data[0].id, 'deepseek-v4-pro')

  const completion = await invoke('/v1/chat/completions', {
    method: 'POST',
    body: { model: 'anything', messages: [{ role: 'user', content: 'hi' }] }
  })
  assert.equal(completion.status, 200)
  assert.equal(JSON.parse(completion.payload).choices[0].message.content, 'bridged')
  assert.equal(calls.length, 1, 'exactly one llm call per request')
  assert.equal(calls[0].provider, 'deepseek')
  assert.equal(calls[0].model, 'deepseek-v4-pro', 'the app-configured model wins over the requested id')
  assert.deepEqual(calls[0].messages[0].content, [{ type: 'text', text: 'hi' }])

  const streamed = await invoke('/v1/chat/completions', {
    method: 'POST',
    body: { model: 'x', stream: true, messages: [{ role: 'user', content: 'hi' }] }
  })
  assert.equal(streamed.status, 200)
  assert.match(streamed.payload, /data: /)
  assert.match(streamed.payload, /bridged/)
  assert.match(streamed.payload, /\[DONE\]/)

  const refused = await invoke('/v1/chat/completions', {
    method: 'POST',
    body: { messages: [{ role: 'user', content: 'hi' }] },
    address: '192.168.1.50'
  })
  assert.equal(refused.status, 403, 'an off-machine caller must be refused')

  const wrongMethod = await invoke('/v1/chat/completions', { method: 'GET' })
  assert.equal(wrongMethod.status, 405)

  const noMessages = await invoke('/v1/chat/completions', { method: 'POST', body: { messages: [] } })
  assert.equal(noMessages.status, 400)

  for (const effect of effects) effect.dispose()
  assert.equal(routes_.size, 0, 'routes must unmount with the effect')
})

await check('the base url helper produces what a codex config needs', () => {
  assert.equal(routes.modelBaseUrl('http://127.0.0.1:19387/'), 'http://127.0.0.1:19387/v1')
  assert.equal(routes.modelBaseUrl('http://127.0.0.1:19387'), 'http://127.0.0.1:19387/v1')
})

// ---------------------------------------------------------------- cleanup
// A killed child can hold its working directory briefly on Windows, and the
// surface's own children used the workspace as cwd, so removal is best-effort.
try {
  fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
} catch (error) {
  console.log(`  note  could not remove the fixture directory: ${error.code ?? error.message}`)
}

console.log(failures ? `localcoding native: ${failures} check(s) failed` : 'localcoding native: all checks passed')
process.exit(failures ? 1 : 0)
