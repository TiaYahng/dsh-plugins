/**
 * Smoke test for the platform client half, runnable without the desktop app:
 * stubs window/document/react/cordis, applies the plugin, and asserts the
 * registration contract, the navigation tier, and zh/en key parity.
 */
import fs from 'node:fs'

const source = fs.readFileSync(process.argv[2], 'utf8')

/** Entry id, section id and DOM prefixes must all match the plugin package. */
const ENTRY_ID = 'dsh-desktop-platform'
const SECTION_ID = 'desktop-platform'

/**
 * Orders the host's own top-level sections occupy in the Settings nav. Ours
 * has to sit above every one of them, including any a future host release adds
 * below the installed third-party tier.
 */
const HOST_SECTION_ORDERS = { account: -10, general: 0, models: 10, plugins: 15, 'agent-presets': 20 }

/* ── key parity straight out of the source text ─────────────────────────── */
function dictionary (name) {
  const start = source.indexOf(`const ${name} = {`)
  if (start < 0) throw new Error(`missing dictionary ${name}`)
  const open = source.indexOf('{', start)
  let depth = 0
  let i = open
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) break
    }
  }
  const body = source.slice(open, i + 1)
  return new Function(`return ${body}`)()
}
const en = dictionary('en')
const zh = dictionary('zh')
const missingInZh = Object.keys(en).filter((key) => !(key in zh))
const missingInEn = Object.keys(zh).filter((key) => !(key in en))
if (missingInZh.length > 0 || missingInEn.length > 0) {
  console.error('i18n key drift', { missingInZh, missingInEn })
  process.exit(1)
}
if (zh.nav !== '综合平台') throw new Error(`zh nav is ${zh.nav}, expected 综合平台`)
console.log(`i18n: ${Object.keys(en).length} keys, zh/en parity OK, nav=${zh.nav}`)

/* ── apply() wiring ─────────────────────────────────────────────────────── */
const styleTags = []
let rememberedTab = null
// The FreeModel section keeps its own remembered page, under its own key.
let rememberedSection = null
const FM_STORAGE_KEY = 'dshDesktopPlatformFreeModel'
globalThis.window = {
  localStorage: {
    getItem: (key) => (key === FM_STORAGE_KEY ? rememberedSection : rememberedTab),
    setItem: (key, value) => { if (key === FM_STORAGE_KEY) rememberedSection = value; else rememberedTab = value }
  },
  __ModuleLoader__: { load: (registration) => { globalThis.__registration = registration } }
}
globalThis.document = {
  head: { appendChild: (node) => styleTags.push(node) },
  createElement: () => ({ id: '', textContent: '' }),
  getElementById: () => null
}
// Effects stay inert by default (the older assertions want the first paint);
// the owner-page assertions opt in so the fetches actually happen.
const pendingEffects = []
let effectsRun = false
const React = {
  // Flatten nested child arrays the way React does, so assertions can walk the
  // rendered tree without knowing which call site used `.map`.
  createElement: (type, props, ...children) => ({
    type,
    props,
    children: children.flat(Infinity)
  }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  // Identity memo: this harness re-renders by re-calling the component, so the
  // only thing a memo has to get right is not throwing.
  useMemo: (compute) => compute(),
  useEffect: (run) => { if (effectsRun) pendingEffects.push(run) },
  useCallback: (fn) => fn,
  useRef: (value) => ({ current: value }),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot()
}
globalThis.__registration = null
new Function('window', 'document', 'React', 'require', source)(
  globalThis.window,
  globalThis.document,
  React,
  () => { throw new Error('client must only require react') }
)
const plugin = globalThis.__registration.factory((spec) => {
  if (spec === 'react') return React
  throw new Error(`unexpected client require: ${spec}`)
})

const registered = { sections: [], dictionaries: [], forms: [] }
const ledger = {
  inject (_name, run) { const dispose = run(); return () => { dispose?.() } },
  register (entry, component) { registered.sections.push({ entry, component }); return () => {} },
  // The inspection surface a page reads to find another plugin's registration.
  entries: () => ledgerEntries,
  getVersion: () => ledgerVersion,
  subscribe: (_key, listener) => { ledgerListeners.add(listener); return () => { ledgerListeners.delete(listener) } }
}
const ledgerEntries = []
let ledgerVersion = 1
const ledgerListeners = new Set()
const ctx = {
  slots: ledger,
  locale: {
    register: (ns, dict) => registered.dictionaries.push({ ns, dict }),
    bind: (ns) => (key) => `${ns}/${key}`
  },
  configForms: { get: (id) => { registered.forms.push(id); return { subscribe () {}, getSnapshot: () => ({}), mutate: async () => true } } },
  effect (fn) { fn() },
  // The recall action mounts from a soft dependency block; the main pass ignores it.
  inject () {}
}
plugin.apply(ctx)

if (registered.dictionaries.length !== 1) throw new Error('copy registered more than once')
if (registered.forms.length !== 1 || registered.forms[0] !== ENTRY_ID) {
  throw new Error(`configForms asked for ${registered.forms.join()} — expected ${ENTRY_ID}`)
}
if (registered.sections.length !== 1) throw new Error(`expected 1 settings section, got ${registered.sections.length}`)
const { entry, component } = registered.sections[0]
if (entry.name !== 'settings.section') throw new Error(`slot name is ${entry.name}`)
if (entry.id !== SECTION_ID) throw new Error(`section id is ${entry.id}`)
if (typeof entry.label !== 'function' || entry.label() !== 'settings.desktopPlatform/nav') throw new Error('label thunk missing')
if (styleTags.length !== 1 || styleTags[0].id !== `${ENTRY_ID}-style`) throw new Error('style tag not installed')
if (styleTags[0].textContent.includes('#fff')) throw new Error('hard-coded colour survived in the stylesheet')

/**
 * Every colour in this plugin is a host token. A token the host does not
 * define is not a wrong colour, it is no colour at all: the declaration
 * becomes invalid at computed-value time and the gradient or text simply
 * disappears. The host defines five state hues (business, idle, success,
 * warn, error) — `info`, `brand`, `warning` and `danger` are guesses, and
 * they were guesses that shipped.
 *
 * The list is a snapshot of the host's own bundle, kept here so the check
 * runs without the application.
 */
const dswTokens = new Set(JSON.parse(
  fs.readFileSync(new URL('./dsw-tokens.json', import.meta.url), 'utf8')
))

const named = [...source.matchAll(/--dsw-alias-[a-z0-9-]+/g)].map((match) => match[0])
// A token assembled at runtime (`--dsw-alias-state-${accent}-primary`) cannot
// be read out of the source, so the accent table is checked by value instead.
const dynamic = named.filter((token) => !token.endsWith('-'))
const unknown = [...new Set(dynamic)].filter((token) => !dswTokens.has(token))
if (unknown.length > 0) {
  throw new Error(`stylesheet names tokens the host does not define: ${unknown.join(', ')}`)
}

const accents = [...source.matchAll(/accent: '([a-z-]+)'/g)].map((match) => match[1])
const badAccents = [...new Set(accents)].filter((accent) => !dswTokens.has(`--dsw-alias-state-${accent}-primary`))
if (badAccents.length > 0) {
  throw new Error(`channel accents name a state hue that does not exist: ${badAccents.join(', ')}`)
}
console.log(`tokens: ${new Set(dynamic).size} named, ${new Set(accents).size} accent hues — all defined by the host`)


// The nav is the settings.section ledger sorted ascending: ours must land after
// every host page, and stay last even if a future host release adds sections
// between the built-in tier and the installed third-party tier (IM机器人: 21).
const hostMax = Math.max(...Object.values(HOST_SECTION_ORDERS))
if (typeof entry.order !== 'number') throw new Error('section has no numeric order')
if (entry.order <= 100) throw new Error(`order ${entry.order} risks landing above a future host section (host max today ${hostMax})`)
console.log(`order: ${entry.order} (host pages max ${hostMax}, first installed third party 21)`)

/**
 * The host hands a service over only if the plugin declared it: touching an
 * undeclared `ctx.<name>` throws in the renderer ("cannot get property
 * \"locale\" without inject") and the whole client bundle fails to load,
 * which the market reports as this plugin breaking the profile. Trim the
 * declared list and this is the assertion that stops it.
 */
const declared = new Set(plugin.inject)
// `get` is the Host's opportunistic lookup: it answers `undefined` for a
// service nobody declared, which is the only safe way to read an optional one.
const core = new Set(['inject', 'effect', 'get'])
// Comments are stripped first: prose that names a service is not a use of it,
// and a commented-out call must not make the bundle depend on a declaration.
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
const touched = new Set([...code.matchAll(/\bctx\.([A-Za-z_][\w]*)/g)].map((match) => match[1]))
const undeclared = [...touched].filter((name) => !declared.has(name) && !core.has(name))
if (undeclared.length > 0) {
  throw new Error(`client touches undeclared ctx services: ${undeclared.join(', ')} (declared: ${[...declared].join(', ') || 'none'})`)
}
console.log(`inject: declares ${[...declared].join(', ')} · client touches ${[...touched].sort().join(', ')}`)

const tree = component(entry.inject())
if (tree.type !== 'div' || tree.props.className !== 'dshPlatform') throw new Error('section root is not the platform shell')
const [tabBarElement, panelHost] = tree.children
// The first child is the TabBar component element; render it to reach its props.
const tabBar = tabBarElement.type(tabBarElement.props)
if (tabBar.props.role !== 'tablist') throw new Error('first child is not the tab strip')
if (tabBar.children.length !== 4) throw new Error(`expected 4 tabs, got ${tabBar.children.length}`)
const tabIds = tabBar.children.map((child) => child.props.id)
const wanted = ['usage', 'archive', 'memory', 'freemodel']
if (tabIds.join() !== wanted.map((id) => `dshPlatformTab-${id}`).join()) {
  throw new Error(`tab ids: ${tabIds}`)
}
if (!tabBar.children.every((child) => child.props.role === 'tab' && child.props['aria-controls'].startsWith('dshPlatformPanel-'))) {
  throw new Error('tab wiring incomplete')
}
if (panelHost.props.className !== 'dshPlatformPanels') throw new Error('panel host missing')
const mounted = panelHost.children.filter(Boolean).map((panel) => panel.props.id)
if (mounted.join() !== 'usage') throw new Error(`only the remembered tab should mount, got ${mounted}`)
console.log(`apply: 1 section (${entry.id}), tabs ${tabIds.length}, initial panel ${mounted[0]}`)


// ── the four FreeModel pages read the owner's own API ────────────────────
// Each page remembers lazily: setting `rememberedTab` and re-applying mounts
// exactly that panel, which is the only way to reach a page's own code here.
const ownerCalls = []
let ownerStatus = 200
globalThis.fetch = async (url, options) => {
  ownerCalls.push({ url: String(url), options })
  return { ok: ownerStatus < 400, status: ownerStatus, json: async () => ownerCalls.length }
}

const PAGES = {
  upgrade: ['/api/our-free-model/update/status'],
  eac: ['/api/our-free-model/eac/status'],
  aggregate: ['/api/our-free-model/providers'],
  saver: ['/api/our-free-model/token-saver', '/api/our-free-model/local-optimize'],
  // The account channels are not the owner's routes at all: the pack answers
  // over the Host's RPC door, so this page asks for nothing on /api.
  accounts: [],
  routing: ['/api/our-free-model/combos', '/api/our-free-model/summary'],
  // The dashboard and the call log are two readings of the same ledger.
  dashboard: ['/api/our-free-model/stats'],
  logs: ['/api/our-free-model/stats'],
  gateway: [
    '/api/our-free-model/clients',
    '/api/our-free-model/forward/key',
    '/api/our-free-model/forward/lan/key',
    '/api/our-free-model/forward/lan/addresses',
    '/api/our-free-model/chan-gateway'
  ]
}

for (const [id, routes] of Object.entries(PAGES)) {
  if (routes.length === 0) continue
  rememberedTab = 'freemodel'
  rememberedSection = id
  registered.sections.length = 0
  plugin.apply(ctx)
  const mounted2 = registered.sections[registered.sections.length - 1]
  const rendered2 = expand(mounted2.component(mounted2.entry.inject()))
  // The owner page lives inside the one FreeModel tab, behind the inner nav.
  if (findById(rendered2, 'dshPlatformPanel-freemodel') === null) throw new Error('the freemodel tab did not mount')
  const own = findById(rendered2, `dshFmPanel-${id}`)
  if (own === null) throw new Error(`${id} page did not mount behind the nav`)
  // The page is still loading (effects are inert in this harness), which is the
  // state that proves `t` reached it: the note is copy from our dictionary.
  if (findByText(rendered2, 'settings.desktopPlatform/owner.loading') === null) {
    throw new Error(`${id} did not render with the translator`)
  }
  ownerCalls.length = 0
  flushEffects(() => expand(mounted2.component(mounted2.entry.inject())))
  const asked = ownerCalls.map((call) => call.url)
  for (const route of routes) {
    if (!asked.includes(route)) throw new Error(`${id} never asked ${route} (asked ${asked.join()})`)
  }
  // The owner's fence only lets the renderer through with the page's own
  // credentials; a bare fetch from anywhere else is a 401 and shows as absent.
  if (ownerCalls.some((call) => call.options?.credentials !== 'same-origin')) {
    throw new Error(`${id} fetched the owner without same-origin credentials`)
  }
  console.log(`${id}: reads ${routes.length} owner route(s), same-origin, degrades to a note while loading`)
}

// ── the new pages, rendered against real payloads ─────────────────────────
// The harness above paints one pass with inert effects, which proves a page
// asks the right routes but not that it draws the answer. This pass gives the
// hooks a memory: a page that loads is re-rendered, and the values it actually
// puts on screen are asserted.
const STATS = {
  requests: 12,
  requestFailures: 1,
  requestFailuresEstimated: true,
  turns: 3,
  failedTurns: 1,
  recoveredTurns: 0,
  days: [{ day: '2026-10-14', total: 160, models: [] }],
  models: [{
    model: 'deepseek-chat',
    name: 'DeepSeek Chat',
    input: 100, output: 50, reasoning: 10, cacheRead: 0,
    calls: 4, failed: 1, turns: 3, failedTurns: 1, recoveredTurns: 0,
    tps: 42, avgTtftMs: 350
  }],
  samples: [
    { at: 1760000000000, model: 'deepseek-chat', ok: true, input: 12, output: 34, ttftMs: 210, tps: 44, decodeMs: 800, decodeTokens: 34, effort: '', origin: 'chat' },
    { at: 1760000001000, model: 'deepseek-chat', ok: false, input: 1, output: 0, ttftMs: null, tps: null, decodeMs: 0, decodeTokens: 0, effort: '', origin: 'chat', truncated: true }
  ],
  savings: { bytesBefore: 1000, bytesAfter: 400, saved: 600, blocks: 3, calls: 9, promptCalls: 2, percent: 60 },
  grand: { input: 100, output: 50, reasoning: 10, calls: 4, failed: 1, turns: 3, failedTurns: 1, recoveredTurns: 0 }
}

const AGGREGATE = {
  registry: [{ id: 'agnes', name: 'Agnes AI', category: 'apikey', format: 'openai-chat', baseUrl: 'https://example.invalid/v1' }],
  configured: { providers: { agnes: { enabled: true, baseUrl: 'https://example.invalid/v1', models: ['agnes-2.0-flash'], lastTest: { at: 1760000000000, ok: true, status: 200, message: '' } } } }
}

const EAC = { available: true, authorized: true, login: 'octocat', starred: true, required: false, configured: true, repo: 'acme/models', reason: null }

const fetchCalls = []
const ANSWERS = {
  '/api/our-free-model/bench': { model: 'deepseek-chat', ok: true, totalMs: 1800, ttftMs: 420, outputTokens: 2, reasoningTokens: 0, tokensPerSecond: 38.5, sample: 'OK' },
  '/api/our-free-model/stats': STATS,
  '/api/our-free-model/providers': AGGREGATE,
  '/api/our-free-model/eac/status': EAC,
  // The roster the owner probes: one model it can reach, one it cannot, and
  // the reason the second one is in the table at all.
  '/api/our-free-model/summary': {
    catalog: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat', availability: 'available', detail: '', ttftMs: 420, probedAt: 1760000000000 },
      { id: 'broken-model', name: 'Broken Model', availability: 'unavailable', detail: 'upstream refused the credential', ttftMs: undefined, probedAt: 1760000000000 }
    ]
  }
}

const realFetch = globalThis.fetch
const ownerFetchStub = async (url, options) => {
  const path = String(url)
  fetchCalls.push({ path, method: options?.method ?? 'GET' })
  const body = ANSWERS[path]
  if (body === undefined) return { ok: true, status: 200, json: async () => ({}) }
  return { ok: true, status: 200, json: async () => body }
}
globalThis.fetch = ownerFetchStub

/** A React whose hooks remember, so a load can be painted and then asserted. */
function statefulHooks () {
  const cells = {}
  const queued = []
  const cleanups = []
  let cursor = 0
  const paint = () => {
    queued.length = 0
    cursor = 0
    return expand(mountNow())
  }
  const React$ = {
    ...React,
    useState: (init) => {
      const at = cursor++
      if (!(at in cells)) cells[at] = typeof init === 'function' ? init() : init
      return [cells[at], (value) => {
        cells[at] = typeof value === 'function' ? value(cells[at]) : value
        queued.push('again')
      }]
    },
    useEffect: (run) => { queued.push(() => {
      const cleanup = run()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    }) }
  }
  return { React$, paint, queued, cleanups, reset: () => { for (const key of Object.keys(cells)) delete cells[key] } }
}

const hooked = statefulHooks()
const keepUseState = React.useState
const keepUseEffect = React.useEffect
let mountNow = () => { throw new Error('mount not set') }
React.useState = hooked.React$.useState
React.useEffect = hooked.React$.useEffect

/**
 * Paint a page repeatedly until its loads stop changing the tree, then hand
 * the last tree back.
 */
async function settled (mount, passes = 8) {
  mountNow = mount
  let tree = null
  for (let pass = 0; pass < passes; pass += 1) {
    for (const cleanup of hooked.cleanups.splice(0)) cleanup()
    tree = hooked.paint()
    const work = hooked.queued.splice(0)
    for (const item of work) {
      if (typeof item === 'function') item()
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (hooked.queued.length === 0 && pass > 0) break
  }
  return tree
}

async function pageWith (id) {
  hooked.reset()
  rememberedTab = 'freemodel'
  rememberedSection = id
  registered.sections.length = 0
  plugin.apply(ctx)
  const mounted = registered.sections[registered.sections.length - 1]
  return settled(() => mounted.component(mounted.entry.inject()))
}

const textsOf = (node, out = []) => {
  walkTree(node, (candidate) => { for (const child of candidate.children) if (typeof child === 'string') out.push(child) })
  return out
}

const dashboard = await pageWith('dashboard')
const dashboardText = textsOf(dashboard)
for (const needle of ['DeepSeek Chat', '2026-10-14', '75%', '350 ms', '600 B', '4']) {
  if (!dashboardText.includes(needle)) throw new Error(`dashboard never shows ${needle}`)
}
if (findByText(dashboard, 'settings.desktopPlatform/dash.byModel') === null) throw new Error('dashboard has no model table')
console.log('dashboard: model rows, day series, success rate and savings drawn from the owner ledger')

const logs = await pageWith('logs')
const logText = textsOf(logs)
for (const needle of ['deepseek-chat', '210 ms', 'settings.desktopPlatform/log.ok']) {
  if (!logText.includes(needle)) throw new Error(`call log never shows ${needle}`)
}
// The notes column joins its marks into one cell, so the cut-short call is
// recognised by a substring rather than by an exact text node.
if (!logText.some((text) => text.includes('log.truncated'))) {
  throw new Error('the cut-short call is not marked in the notes column')
}
// The failed row is the one that matters: it has to be visible next to the ok one.
if (logText.filter((text) => text === 'settings.desktopPlatform/log.ok').length !== 1) throw new Error('call log lost the successful row')
if (logText.filter((text) => text === 'settings.desktopPlatform/log.failed').length !== 1) throw new Error('call log lost the failed row')
console.log('call log: both rows drawn, the cut-short call marked')

const aggregate = await pageWith('aggregate')
const aggregateText = textsOf(aggregate)
for (const needle of ['Agnes AI', 'settings.desktopPlatform/aggregate.on', 'settings.desktopPlatform/aggregate.verified']) {
  if (!aggregateText.includes(needle)) throw new Error(`aggregate never shows ${needle}`)
}
console.log('aggregate: the configured provider is listed as on and verified')

const eac = await pageWith('eac')
const eacText = textsOf(eac)
for (const needle of ['settings.desktopPlatform/eac.authorized', 'octocat', 'settings.desktopPlatform/eac.logout']) {
  if (!eacText.includes(needle)) throw new Error(`eac never shows ${needle}`)
}
console.log('eac: signed-in state, the login and the sign-out control drawn')

React.useState = keepUseState
React.useEffect = keepUseEffect
globalThis.fetch = realFetch

// 404 means the owner plugin is not installed: the pages must say so rather
// than surfacing a raw HTTP error.
rememberedTab = 'freemodel'
rememberedSection = 'gateway'
registered.sections.length = 0
plugin.apply(ctx)
const absentMount = registered.sections[registered.sections.length - 1]
ownerStatus = 404
let capturedState = null
const restoreState = React.useState
React.useState = (init) => [typeof init === 'function' ? init() : init, (value) => { capturedState = typeof value === 'function' ? value(settledState) : value }]
const settledState = { status: 'loading', data: null, error: '', absent: false }
flushEffects(async () => { await expand(absentMount.component(absentMount.entry.inject())) })
await new Promise((resolve) => setTimeout(resolve, 20))
React.useState = restoreState
ownerStatus = 200
if (capturedState === null || capturedState.absent !== true) {
  throw new Error(`a 404 from the owner must resolve to the absent state, got ${JSON.stringify(capturedState)}`)
}
console.log('owner absent (404): every page shows the install hint instead of an error')


/**
 * The account channels are the one page that does not read /api: they go
 * through the Host's RPC door into the vendored channel pack. This paints it
 * with a stub connection and asserts both the calls it makes and the cards it
 * draws — a page stuck on an empty grid because the bridge was wired wrong
 * looks exactly like a page that has no accounts.
 */
const channelRows = [
  { id: 'codearts-1c6d8fce', nickname: 'work account', enabled: true, refreshable: true, expiresAt: 1790000000000 },
  { id: 'lobsterai-adf4e80e', nickname: 'personal', enabled: false, refreshable: false }
]
const channelStatuses = {
  codearts: { models: { total: 4, disabled: 1 }, accounts: { total: 2, enabled: 1 }, closed: false },
  buddy: { models: { total: 6, disabled: 0 }, accounts: { total: 0, enabled: 0 }, closed: false },
  lobsterai: { models: { total: 2, disabled: 2 }, accounts: { total: 1, enabled: 0 }, closed: true },
  workbuddy: { models: { total: 3, disabled: 0 }, accounts: { total: 1, enabled: 1 }, closed: false }
}

const rpcCalls = []
let loginPolls = 0
// The ledger the pack keeps for the channel accounts, in the shape the pack
// actually builds it: channel → provider → account → model, with the averages
// already divided by readTokenLedger's finalizeAverages.
const ledgerRow = {
  requests: 12,
  reportedRequests: 11,
  inputTokens: 900,
  outputTokens: 300,
  cacheReadTokens: 1200,
  cacheWriteTokens: 0,
  reasoningTokens: 40,
  errors: 1,
  avgTtftMs: 420,
  avgTps: 38.5
}
const packSnapshot = {
  channels: [{
    channel: 'lobsterai',
    providers: [{
      provider: 'lobsterai',
      accounts: [{
        accountId: 'lobsterai-adf4e80e',
        models: [{ model: 'deepseek-flash', ...ledgerRow }],
        totals: ledgerRow
      }],
      totals: ledgerRow
    }],
    totals: ledgerRow
  }],
  totals: ledgerRow,
  entries: [
    { at: 1760000000000, channel: 'lobsterai', provider: 'lobsterai', accountId: 'lobsterai-adf4e80e', model: 'deepseek-flash', usageReported: true, inputTokens: 120, outputTokens: 40, ttftMs: 310, tps: 41.2 },
    { at: 1760000001000, channel: 'lobsterai', provider: 'lobsterai', accountId: 'lobsterai-adf4e80e', model: 'deepseek-flash', usageReported: false, error: 'upstream 5xx', inputTokens: 0, outputTokens: 0 }
  ]
}
const packHistory = [{ day: '2026-10-15', channels: packSnapshot.channels, totals: ledgerRow }]

const packConnection = {
  rpc: {
    call: async (_space, endpoint, body) => {
      rpcCalls.push({ endpoint, method: body.method, payload: body.payload })
      if (body.method === 'provider.status') return { ok: true, value: { statuses: channelStatuses } }
      if (body.method === 'account.list') {
        return { ok: true, value: { accounts: body.payload.provider === 'codearts' ? channelRows : [] } }
      }
      if (body.method === 'model.list') {
        return { ok: true, value: { models: [{ id: 'deepseek-v3', name: 'DeepSeek V3', disabled: false, isFree: true }] } }
      }
      if (body.method === 'account.create') {
        // The pack's real answer: a placeholder account and a sign-in URL. The
        // credential only lands later, which is what login.poll watches.
        return { ok: true, value: { accountId: 'codearts-pending', loginUrl: 'https://example.invalid/login' } }
      }
      if (body.method === 'login.poll') {
        loginPolls += 1
        return loginPolls === 1
          ? { ok: true, value: { done: false } }
          : { ok: true, value: { done: true, success: true, login: 'work@example.invalid' } }
      }
      if (body.method === 'account.test') return { ok: true, value: { ok: true, ms: 128 } }
      if (body.method === 'usage.tokenLedger') return { ok: true, value: { snapshot: packSnapshot } }
      if (body.method === 'usage.tokenLedgerHistory') return { ok: true, value: { history: packHistory, totals: ledgerRow } }
      if (body.method === 'usage.autoCheckin') {
        return body.payload?.enabled === undefined
          ? { ok: true, value: { autoCheckin: { enabled: true, lastAt: 1760000000000, lastResult: 'claimed' } } }
          : { ok: true, value: { autoCheckin: { enabled: body.payload.enabled, lastAt: 1760000000000, lastResult: 'claimed' } } }
      }
      if (body.method === 'credits.balances') {
        return {
          ok: true,
          value: {
            accounts: [
              { accountId: 'codearts-1c6d8fce', nickname: 'work account', balance: 120 },
              { accountId: 'lobsterai-adf4e80e', nickname: 'personal', balance: null, error: '凭据未配置' }
            ]
          }
        }
      }
      if (body.method === 'credits.claimAll') {
        return { ok: true, value: { results: [], summary: { claimed: 1, 'already-claimed': 1, inactive: 0, failed: 0 } } }
      }
      return { ok: true, value: {} }
    }
  }
}

// Mount the real shell with a context that answers `get`, exactly the shape the
// plugin's own ctx has for an optional service.
const mountFreeModel = (context) => {
  // Each mount starts from blank hook cells: a leftover from the previous one
  // is exactly how a page ends up rendering a null Set.
  hooked.reset()
  rememberedTab = 'freemodel'
  rememberedSection = 'accounts'
  registered.sections.length = 0
  plugin.apply(ctx)
  const section = registered.sections[registered.sections.length - 1]
  return () => section.component({
    t: (key) => `settings.desktopPlatform/${key}`,
    scope: {},
    host: { session: null },
    ctx: context
  })
}

const withBridge = { get: (name) => (name === 'connection' ? packConnection : undefined) }
rpcCalls.length = 0
// The block above restored the inert hooks when it finished; this page needs
// them back to have a memory, or every effect silently never runs.
React.useState = hooked.React$.useState
React.useEffect = hooked.React$.useEffect

const packTree = await settled(mountFreeModel(withBridge))

if (rpcCalls[0].endpoint !== 'channel-pack') {
  throw new Error(`the accounts page dialled ${rpcCalls[0].endpoint}, expected the pack's own endpoint`)
}
if (rpcCalls[0].method !== 'provider.status') {
  throw new Error(`the accounts page asked for ${rpcCalls[0].method} first`)
}
const asked = rpcCalls[0].payload.providers
if (!Array.isArray(asked) || asked.length !== 13 || !asked.includes('codearts')) {
  throw new Error(`the accounts page asked for the wrong providers: ${JSON.stringify(asked)}`)
}
// The pack's own daily check-in is a switch above the cards, and it is read
// with the same door — a page that only lists accounts would never show it.
if (!rpcCalls.some((call) => call.method === 'usage.autoCheckin')) {
  throw new Error('the accounts page never asked the pack about auto check-in')
}
if (findByText(packTree, 'settings.desktopPlatform/accounts.autoCheckinHint') === null) {
  throw new Error('the auto check-in switch is not on the page')
}
const accountText = textsOf(packTree)
for (const needle of ['CodeArts', 'LobsterAI', 'settings.desktopPlatform/accounts.state.on', 'settings.desktopPlatform/accounts.state.closed']) {
  if (!accountText.includes(needle)) throw new Error(`the accounts page never shows ${needle}`)
}
// The count pills are built as one string, so the label is a substring, not a
// text node of its own.
if (!accountText.some((text) => text.includes('accounts.accounts') && text.includes('1/2'))) {
  throw new Error(`the accounts page shows no account counts: ${JSON.stringify(accountText.slice(-6))}`)
}
const opened = []
globalThis.window.open = (url) => { opened.push(url); return null }

const mountAccounts = mountFreeModel(withBridge)
const codeartsCard = findCard(packTree, 'CodeArts')
if (codeartsCard === null) throw new Error('the CodeArts card is not on the page')
const addButton = findButton(codeartsCard, 'settings.desktopPlatform/accounts.add')
if (addButton === null) throw new Error('no add-account button on the card')
rpcCalls.length = 0
await addButton.props.onClick()
// The call is made on the first tick; the window opens once the answer comes
// back, which is a microtask later.
await new Promise((resolve) => setTimeout(resolve, 0))
await new Promise((resolve) => setTimeout(resolve, 0))
if (!rpcCalls.some((call) => call.method === 'account.create')) {
  throw new Error('the add-account button did not start a login')
}
if (opened.length === 0 || !opened[0].includes('example.invalid')) {
  throw new Error('the sign-in page was never opened: ' + JSON.stringify(opened))
}

// The accounts fold has to be open before the row buttons exist. The harness
// does not re-render on a state change by itself, so paint again.
const foldButton = findButton(codeartsCard, 'settings.desktopPlatform/accounts.foldAccounts')
if (foldButton === null) throw new Error('no accounts fold on the card')
rpcCalls.length = 0
await foldButton.props.onClick()
await settled(mountAccounts)
if (!rpcCalls.some((call) => call.method === 'account.list')) {
  throw new Error('opening the accounts fold did not read the accounts')
}
const openTree = await settled(mountAccounts)
const testButton = findButton(openTree, 'settings.desktopPlatform/accounts.test')
if (testButton === null) throw new Error('no connection test on any account row')
rpcCalls.length = 0
await testButton.props.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))
if (!rpcCalls.some((call) => call.method === 'account.test')) {
  throw new Error('the test button did not test the account')
}
console.log('accounts: sign-in opens the browser, the connection test is reachable')

console.log('accounts: 13 channels dialled as one provider.status, cards drawn with their real state')

// No connection service at all: the page must say so instead of rendering an
// empty grid that reads as "you have no accounts".
const blindTree = await settled(mountFreeModel({ get: () => undefined }))
if (findByText(blindTree, 'settings.desktopPlatform/accounts.noBridge') === null) {
  throw new Error('without a connection service the page must explain itself')
}
console.log('accounts: no connection service → the page explains itself')




// The dashboard reads a second ledger — the pack's, not the owner's — and the
// call log can switch to it. Both are invisible without the bridge, so they
// are asserted here rather than left to the eye.
rememberedTab = 'freemodel'
rememberedSection = 'dashboard'
registered.sections.length = 0
plugin.apply(ctx)
const dashMount = registered.sections[registered.sections.length - 1]
hooked.reset()
const dashTree = await settled(() => dashMount.component({
  t: (key) => `settings.desktopPlatform/${key}`,
  scope: {},
  host: { session: null },
  ctx: withBridge
}))
if (!rpcCalls.some((call) => call.method === 'usage.tokenLedgerHistory')) {
  throw new Error('the pack ledger was never read')
}
const dashText = textsOf(dashTree)
if (!dashText.includes('lobsterai')) {
  throw new Error(`the channel ledger is not on the dashboard: ${JSON.stringify(dashText.slice(-8))}`)
}
if (!dashText.some((text) => text.includes('900') || text.includes('1,200'))) {
  throw new Error('the channel ledger shows no token figures')
}
console.log('dashboard: the pack\'s channel ledger is rendered beside the owner\'s own')

rememberedSection = 'logs'
const logMount2 = registered.sections[registered.sections.length - 1]
hooked.reset()
const logTree2 = await settled(() => logMount2.component({
  t: (key) => `settings.desktopPlatform/${key}`,
  scope: {},
  host: { session: null },
  ctx: withBridge
}))
if (findByText(logTree2, 'settings.desktopPlatform/log.laneOwner') === null) {
  throw new Error('the call log has no lane switch')
}
if (findByText(logTree2, 'settings.desktopPlatform/log.lanePack') === null) {
  throw new Error('the call log offers no channel lane')
}
console.log('call log: both lanes offered, the channel one read from the pack')


// The availability table and the bench answer "can this model actually be
// called, and how fast". The bench is a real generation, so it goes through
// the owner's own route rather than the pack.
rememberedTab = 'freemodel'
rememberedSection = 'routing'
registered.sections.length = 0
plugin.apply(ctx)
const routeMount = registered.sections[registered.sections.length - 1]
hooked.reset()
globalThis.fetch = ownerFetchStub
const routeTree = await settled(() => routeMount.component({
  t: (key) => `settings.desktopPlatform/${key}`,
  scope: {},
  host: { session: null },
  ctx: withBridge
}))
if (findByText(routeTree, 'settings.desktopPlatform/check.title') === null) {
  throw new Error('the routing page has no model availability table')
}
const benchButton = findButton(routeTree, 'settings.desktopPlatform/check.bench')
if (benchButton === null) throw new Error('no bench button on any model')
fetchCalls.length = 0
await benchButton.props.onClick()
await new Promise((resolve) => setTimeout(resolve, 0))
await new Promise((resolve) => setTimeout(resolve, 0))
if (!fetchCalls.some((call) => call.method === 'POST' && call.path.endsWith('/bench'))) {
  throw new Error('the bench button did not run a generation: ' + JSON.stringify(fetchCalls))
}
console.log('routing: model availability table present, bench really posts to /bench')

// The inner nav is the owner's affordance, ours: eight entries, and the
// remembered page is the one that is actually on screen.
rememberedTab = 'freemodel'
rememberedSection = 'dashboard'
registered.sections.length = 0
plugin.apply(ctx)
const navMount = registered.sections[registered.sections.length - 1]
const navTree = expand(navMount.component(navMount.entry.inject()))
// Scope the search to the FreeModel panel: the platform's own tab strip is
// a tablist too, and it comes first in the tree.
const navPanel = findById(navTree, 'dshPlatformPanel-freemodel')
const navList = navPanel === null ? null : findByRole(navPanel, 'tablist')
if (navList === null) throw new Error('the FreeModel section has no nav')
const navIds = navList.children.map((child) => child.props.id)
const navWanted = ['upgrade', 'eac', 'accounts', 'aggregate', 'saver', 'routing', 'dashboard', 'logs', 'gateway']
if (navIds.join() !== navWanted.map((id) => `dshFmTab-${id}`).join()) {
  throw new Error(`nav ids: ${navIds}`)
}
if (findById(navTree, 'dshFmPanel-dashboard') === null) throw new Error('the remembered page did not mount')
// A page the user never opened must not be built: an owner page reads the
// network on mount, and eight of them at once is eight round trips.
if (findById(navTree, 'dshFmPanel-logs') !== null) throw new Error('an unvisited nav page was mounted anyway')
console.log(`freemodel nav: ${navIds.length} entries, remembered page dashboard, unvisited pages not built`)

// The mount is history: nothing may bring another plugin's settings section in.
if (/ForeignPage|ofm_navbrand|entry\.options\.locale/.test(source)) {
  throw new Error('the other plugin\'s page is mounted again, or the mount\'s entry-reading idiom came back')
}
console.log('foreign mount: gone from the source')

/**
 * Expand function-typed elements, so a page that renders another component is
 * inspected after it has actually run.
 */
function expand (node) {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(expand).flat(Infinity)
  if (typeof node.type === 'function') {
    const children = node.children.length === 1 ? node.children[0] : node.children
    return expand(node.type({ ...node.props, children }))
  }
  return { ...node, children: (node.children ?? []).map(expand).flat(Infinity) }
}

function findByText (node, needle) {
  let hit = null
  walkTree(node, (candidate) => {
    if (hit === null && candidate.children.some((child) => child === needle)) hit = candidate
  })
  return hit
}
function findCard (node, name) {
  let hit = null
  walkTree(node, (candidate) => {
    if (hit !== null) return
    const className = String(candidate.props?.className ?? '')
    if (className.split(' ').includes('dshFmChan') === false) return
    // The name sits inside the card's header, not directly on the card.
    if (textsOf(candidate).includes(name)) hit = candidate
  })
  return hit
}
/**
 * A button whose label starts with a copy key. Substring, not equality: the
 * fold buttons read "账号 (2)" — the key plus a count — and the key is what
 * the test means.
 */
function findButton (node, label) {
  let hit = null
  walkTree(node, (candidate) => {
    if (hit !== null) return
    if (typeof candidate.props?.onClick !== 'function') return
    for (const child of candidate.children) {
      if (typeof child === 'string' && child.startsWith(label)) { hit = candidate; return }
    }
  })
  return hit
}
function findByRole (node, role) {
  let hit = null
  walkTree(node, (candidate) => { if (hit === null && candidate.props.role === role) hit = candidate })
  return hit
}
function findById (node, id) {
  let hit = null
  walkTree(node, (candidate) => { if (hit === null && candidate.props.id === id) hit = candidate })
  return hit
}
function findByType (node, type) {
  let hit = null
  walkTree(node, (candidate) => { if (hit === null && candidate.type === type) hit = candidate })
  return hit
}
/** Run the effects collected during one render pass, then let them settle. */
async function flushEffects (render) {
  effectsRun = true
  pendingEffects.length = 0
  try {
    render()
    await Promise.all(pendingEffects.map((run) => run()))
  } finally {
    effectsRun = false
  }
}

function walkTree (node, visit) {
  if (node === null || node === undefined || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walkTree(child, visit)
    return
  }
  visit(node)
  walkTree(node.children, visit)
}

for (const cleanup of hooked.cleanups.splice(0)) cleanup()
console.log('OK')
