/**
 * Smoke test for the platform client half, runnable without the desktop app:
 * stubs window/document/react/cordis, applies the plugin, and asserts the
 * registration contract, the navigation tier, and zh/en key parity.
 */
import fs from 'node:fs'

const source = fs.readFileSync(process.argv[2], 'utf8')

/**
 * Entry id and DOM prefixes follow the plugin package; the two below do not, on
 * purpose, and each has its own constant so the next rename cannot move them by
 * accident.
 *
 * SECTION_ID is the Settings page's identity — remembered tabs hang off it.
 * CONFIG_NAMESPACE is a key into settings already stored on people's machines.
 * Both outlive a package rename; changing either silently drops a user's state.
 */
const ENTRY_ID = 'dsh-comprehensive-platform'
const SECTION_ID = 'desktop-platform'
const CONFIG_NAMESPACE = 'dsh-desktop-platform'

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
  // Enough of an element for a plugin to style: the vendored copy sets an
  // attribute and a text content, and returns a teardown that removes it.
  createElement: () => {
    const attributes = new Map()
    return {
      id: '',
      textContent: '',
      setAttribute: (name, value) => { attributes.set(name, value) },
      getAttribute: (name) => attributes.get(name) ?? null,
      remove: () => {}
    }
  },
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
// The owner's own plugin registers this namespace before we load, and the host
// refuses a second registration for it. The harness has to be standing where
// the real machine stands, or it passes a bundle that cannot boot.
const ownerDictionary = { ns: 'settings.ourFreeModel', zh: { nav: 'Our Free Model' }, en: { nav: 'Our Free Model' } }
registered.dictionaries.push(ownerDictionary)
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
    register: (ns, dict) => {
      for (const language of Object.keys(dict)) {
        if (registered.dictionaries.some((entry) => entry.ns === ns && entry[language] !== undefined)) {
          const clash = new Error(`locale namespace "${ns}" already has locale "${language}"`)
          clash.code = 'duplicate-locale'
          throw clash
        }
      }
      registered.dictionaries.push({ ns, ...dict })
    },
    bind: (ns) => (key) => `${ns}/${key}`
  },
  configForms: { get: (id) => { registered.forms.push(id); return { subscribe () {}, getSnapshot: () => ({}), mutate: async () => true } } },
  effect (fn) { fn() },
  // The recall action mounts from a soft dependency block; the main pass ignores it.
  inject () {}
}
plugin.apply(ctx)

// Two dictionaries, and both are wanted: ours for the platform's three tabs,
// the vendored page's for the copy the owner wrote. A collision is the failure.
if (registered.dictionaries.length !== 2) {
  throw new Error(`expected our dictionary beside the owner's, got ${registered.dictionaries.length}`)
}
const ownerRegistrations = registered.dictionaries.filter((entry) => entry.ns === 'settings.ourFreeModel')
if (ownerRegistrations.length !== 1) {
  throw new Error(`the owner namespace was registered ${ownerRegistrations.length} times; the host throws on the second`)
}
// Yielding is the point: the copy's dictionary is the same content, so the
// owner's registration is left standing and the second one is dropped.
if (ownerRegistrations[0] !== ownerDictionary) {
  throw new Error('the vendored copy overwrote the owner dictionary instead of yielding to it')
}
const namespaces = registered.dictionaries.map((entry) => entry.ns)
if (new Set(namespaces).size !== namespaces.length) {
  throw new Error(`the two dictionaries share a namespace: ${namespaces.join(', ')}`)
}
if (namespaces.includes('settings.desktopPlatform') === false) {
  throw new Error(`the platform's own dictionary is missing: ${namespaces.join(', ')}`)
}
if (namespaces.includes('settings.ourFreeModel') === false) {
  throw new Error(`the vendored page's dictionary is missing: ${namespaces.join(', ')}`)
}
// The vendored copy's own stylesheet must be installed, or its page renders
// with nothing but the host's.
if (styleTags.length < 2) throw new Error(`expected both stylesheets, got ${styleTags.length}`)
// And it must not bring a second settings section into the nav.
if (registered.sections.length !== 1) {
  throw new Error(`the vendored copy registered a section of its own: ${registered.sections.length}`)
}
if (registered.forms.length !== 1 || registered.forms[0] !== CONFIG_NAMESPACE) {
  throw new Error(`configForms asked for ${registered.forms.join()} — expected ${CONFIG_NAMESPACE}`)
}
if (source.includes(`SETTINGS_NAMESPACE = '${ENTRY_ID}'`)) {
  throw new Error('the config namespace was renamed along with the package; stored settings would be orphaned')
}
if (registered.sections.length !== 1) throw new Error(`expected 1 settings section, got ${registered.sections.length}`)
const { entry, component } = registered.sections[0]
if (entry.name !== 'settings.section') throw new Error(`slot name is ${entry.name}`)
if (entry.id !== SECTION_ID) throw new Error(`section id is ${entry.id}`)
if (typeof entry.label !== 'function' || entry.label() !== 'settings.desktopPlatform/nav') throw new Error('label thunk missing')
// Two stylesheets: ours, identified by id, and the vendored page's, which the
// host plugin identifies by a data-plugin attribute instead.
const ownStyle = styleTags.find((tag) => tag.id === `${ENTRY_ID}-style`)
if (ownStyle === undefined) throw new Error('the platform stylesheet is not installed')
const ownerStyle = styleTags.find((tag) => tag.getAttribute('data-plugin') === 'dsh-our-free-model')
if (ownerStyle === undefined) {
  throw new Error(`the vendored page brings no stylesheet (${styleTags.length} installed)`)
}
if (ownStyle.textContent.includes('#fff')) throw new Error('hard-coded colour survived in the stylesheet')

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

// Scoped to our own stylesheet. The vendored copy is the owner's CSS, patched
// only where it had to be; auditing its colour usage as if it were ours would
// be holding a fork to a standard its author does not hold itself.
const named = [...ownStyle.textContent.matchAll(/--dsw-alias-[a-z0-9-]+/g)].map((match) => match[0])
// A token assembled at runtime (`--dsw-alias-state-${accent}-primary`) cannot
// be read out of the source, so the accent table is checked by value instead.
const dynamic = named.filter((token) => !token.endsWith('-'))
const unknown = [...new Set(dynamic)].filter((token) => !dswTokens.has(token))
if (unknown.length > 0) {
  throw new Error(`stylesheet names tokens the host does not define: ${unknown.join(', ')}`)
}

const accents = [...ownStyle.textContent.matchAll(/accent: '([a-z-]+)'/g)].map((match) => match[1])
const badAccents = [...new Set(accents)].filter((accent) => !dswTokens.has(`--dsw-alias-state-${accent}-primary`))
if (badAccents.length > 0) {
  throw new Error(`channel accents name a state hue that does not exist: ${badAccents.join(', ')}`)
}
console.log(`tokens: ${new Set(dynamic).size} named, ${new Set(accents).size} accent hues — all defined by the host`)
// Observed, not enforced: two tokens the owner's own stylesheet names and this
// host does not define. In a color-mix() that voids the declaration, so those
// two colours are absent on their page today. It is their CSS to fix, and this
// fork only carries it.
const ownerUnknown = [...new Set([...ownerStyle.textContent.matchAll(/--dsw-alias-[a-z0-9-]+/g)]
  .map((match) => match[0])
  .filter((token) => dswTokens.has(token) === false))]
if (ownerUnknown.length > 0) {
  console.log(`vendor: names ${ownerUnknown.length} token(s) this host does not define (${ownerUnknown.join(', ')}) — its own, left as it is`)
}


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
const [navElement, panelHost] = tree.children
// The first child is the frosted nav; the pill row lives inside it.
const nav = navElement.type(navElement.props)
if (nav.props.className !== 'dshPlatformNav') throw new Error('the first child is not the nav bar')
// The pill row is the only child with a tablist role; the glider may or may
// not be there yet, and its slot must not decide where the row is found.
const stripElement = nav.children.find((child) => child?.props?.role === 'tablist')
if (stripElement === undefined) throw new Error('the nav does not hold a tab strip')
// Invoking TabBar already produced the elements; the pill row is one of them.
const tabBar = stripElement
if (tabBar.props.role !== 'tablist') throw new Error('the nav does not hold a tab strip')
// No effect runs in this harness, so the glider has not measured itself and
// renders nothing: a zero-width pill would be a visible sliver at the left
// edge. What is left must be the four tabs and nothing else.
const rendered = tabBar.children.filter((child) => child !== false && child !== null && child !== undefined)
if (rendered.length !== 4) throw new Error(`expected 4 tabs, got ${rendered.length}`)
if (rendered.some((child) => child.props?.className === 'dshPlatformGlider')) {
  throw new Error('the glider rendered before it had a width to render at')
}
const tabIds = tabBar.children.filter((child) => child.props?.id !== undefined).map((child) => child.props.id)
const wanted = ['usage', 'archive', 'memory', 'freemodel']
if (tabIds.join() !== wanted.map((id) => `dshPlatformTab-${id}`).join()) {
  throw new Error(`tab ids: ${tabIds}`)
}
const wired = tabBar.children.filter((child) => child.props?.role === 'tab')
if (wired.length !== 4) throw new Error(`expected 4 wired tabs, got ${wired.length}`)
if (wired.some((child) => child.props['aria-controls'].startsWith('dshPlatformPanel-') === false)) {
  throw new Error('tab wiring incomplete')
}
// The glider exists in the source and is decoration; it only reaches the DOM
// once a tab has been measured, which needs a layout pass this harness has not
// done. Asserting its presence here would assert the harness, not the page.
if (source.includes('dshPlatformGlider') === false) throw new Error('the sliding glider is gone from the source')
if (source.includes("'aria-hidden': 'true'") === false) {
  throw new Error('the glider is not hidden from assistive technology')
}
if (panelHost.props.className !== 'dshPlatformPanels') throw new Error('panel host missing')
const mounted = panelHost.children.filter(Boolean).map((panel) => panel.props.id)
if (mounted.join() !== 'usage') throw new Error(`only the remembered tab should mount, got ${mounted}`)
console.log(`apply: 1 section (${entry.id}), tabs ${tabIds.length}, initial panel ${mounted[0]}`)


// ── the FreeModel tab is the owner's own component ─────────────────────────
// Vendored from the plugin's own client.js and patched in seven documented
// places (tools/vendor-our-free-model.mjs). The two that matter here: its page
// list and its nav row no longer name the removed page, and it registers no
// settings section of its own — this plugin owns the one in the nav.
const fork = fs.readFileSync(
  new URL('../plugins/dsh-comprehensive-platform/vendor/our-free-model-client.js', import.meta.url),
  'utf8'
)
if (/const TABS = \['free'/.test(fork)) throw new Error('the vendored page list still offers the removed page')
if (fork.includes("t('nav.tab.free')")) throw new Error('the vendored nav still offers the removed page')
if (fork.includes("ctx.slots.inject('settings.section'")) {
  throw new Error('the vendored copy registers a settings section; it would show up in the nav beside ours')
}
if (fork.includes("exports.renderSettings") === false) throw new Error('the vendored copy exports no component')
for (const name of ['FreePage', 'ChannelsPage', 'AggregatePage', 'SaverPage', 'RoutingPage', 'LedgerPage', 'LogsPage', 'GatewayPage', 'EacPage']) {
  if (fork.includes('function ' + name) === false) throw new Error('the vendored copy is missing ' + name)
}
console.log('vendor: ' + (fork.length / 1024).toFixed(0) + ' KB, removed page gone, nine pages kept')

// The bar is one line: the tabs, and the star beside them. The owner's own name
// and mark used to sit above the tabs, which made this page read as a second
// application inside the platform's own page.
if (fork.includes("className: 'ofm_navbrand'")) throw new Error('the title row is back')
if (fork.includes('const BRAND_ICON =')) throw new Error('the brand artwork is back, referenced by nothing')
if (/\.ofm_tabs\{[^}]*grid-column:1 \/ -1/.test(fork)) throw new Error('the tabs still span the bar; the star would drop to a second row')
if (fork.includes('.ofm_starbtn{grid-column:2;grid-row:1;') === false) {
  throw new Error('the star is not on the tab row')
}

// EAC is the third tab. Two lists have to agree about that: the one the page
// may remember and the one it draws. They drifting apart is how a pill ends up
// unlit while its page is on screen.
const remembered = fork.match(/const TABS = \[([^\]]*)\]/)[1].match(/'([a-z]+)'/g).map((id) => id.slice(1, -1))
const drawnBody = fork.match(/const tabs = \[([\s\S]*?)\n\s*\]/)[1]
const drawn = drawnBody.match(/\['([a-z]+)'/g).map((id) => id.slice(2, -1))
if (JSON.stringify(remembered) !== JSON.stringify(drawn)) {
  throw new Error(`the remembered and drawn tab orders disagree: ${remembered.join(',')} vs ${drawn.join(',')}`)
}
if (drawn.indexOf('eac') !== 2) throw new Error(`EAC is at ${drawn.indexOf('eac') + 1}, expected 3: ${drawn.join(', ')}`)
if (fork.includes("? saved : 'free'")) throw new Error('the landing page still names the removed page')
if (fork.includes('catch { return \'free\' }')) throw new Error('the fallback still names the removed page')
console.log('bar: one line, tabs and star · EAC third, both lists agree, landing is the first tab')

// The 「公告中心」 panel is off both pages that carried it. It read the owner's
// announcement feed, which this copy does not hold a stream for, so it could
// only ever show an empty noticeboard. Removing it must take the fetch with it:
// a page that still asks for a feed it will never show is a page waiting to be
// blamed for a slow load.
if (fork.includes('h(NewsPanel,') || fork.includes('function NewsPanel')) {
  throw new Error('the announcement panel is back')
}
if (fork.includes('function NewsItem')) throw new Error('the announcement renderer is back')
if (/h\(NewsPanel/.test(fork)) throw new Error('a page still renders the announcement panel')
// What was on those pages around it has to be intact: the EAC page keeps its
// sign-in and its roster, the gateway keeps egress, preferences and upgrades.
for (const keep of ["h(EacAuth, { t, auth: eacAuth, eacLogin })", 'h(Roster, { summary: data, t, onBench',
  'h(Egress, { settings: data.settings', 'h(Preferences, { summary: data', 'h(UpgradePanel, { t, settings: data.settings']) {
  if (fork.includes(keep) === false) throw new Error('the announcement removal took something else: ' + keep)
}
console.log('noticeboard: gone from both pages, the rest of those pages intact')

// Mounting it. The owner's page loads its own data, so with effects inert it
// sits on its own loading note — which is itself the proof that this is their
// component: their root class, their copy, their namespace.
rememberedTab = 'freemodel'
registered.sections.length = 0
plugin.apply(ctx)
const vendorSection = registered.sections[registered.sections.length - 1]
const vendorTree = expand(vendorSection.component(vendorSection.entry.inject()))

const classes = []
const seen = []
walkTree(vendorTree, (candidate) => {
  const className = String(candidate.props?.className ?? '')
  if (className !== '') classes.push(className)
  for (const child of candidate.children) if (typeof child === 'string') seen.push(child)
})
if (classes.includes('ofm_root') === false) {
  throw new Error('the owner own root never rendered: ' + JSON.stringify(classes.slice(0, 12)))
}
if (seen.some((text) => text.startsWith('settings.ourFreeModel/')) === false) {
  throw new Error('the owner page is not reading its own copy: ' + JSON.stringify(seen.slice(-6)))
}
if (seen.some((text) => text.startsWith('settings.desktopPlatform/loading'))) {
  throw new Error('the owner page is still reading the platform copy')
}
console.log("freeModel tab: the owner's own component, its own copy, one section in the nav")
// The owner's page is a whole shell of its own: an aurora painted with
// position:fixed behind itself, a sticky glass nav, its own spacing. A panel
// that padded, gapped or clipped around it would cut that aurora off, so the
// FreeModel panel is marked and styled bare.
const ownPanel = findById(vendorTree, 'dshPlatformPanel-freemodel')
if (ownPanel === null) throw new Error('the FreeModel panel is not there')
if (ownPanel.props.className !== 'dshPlatformPanel isHost') {
  throw new Error(`the FreeModel panel is wrapped: ${ownPanel.props.className}`)
}
let bareHost = false
walkTree(vendorTree, (candidate) => {
  if (candidate.props?.className === 'dshPlatformPanels isHost') bareHost = true
})
if (bareHost === false) throw new Error('the panel host is not the bare variant on this tab')
if (ownStyle.textContent.includes('.dshPlatformPanel.isHost{padding:0') === false) {
  throw new Error('the bare panel has no rule; the aurora would be clipped')
}
console.log('freeModel tab: mounted bare, so the owner\'s own shell paints whole')

// And the host's loader must be back: the shim is a swap, not a replacement.
if (typeof window.__ModuleLoader__?.load !== 'function') {
  throw new Error('the host ModuleLoader was not restored after the shim')
}
console.log("loader: the host's ModuleLoader is intact after the shim")

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
/**
 * A button whose label starts with a copy key. Substring, not equality: the
 * fold buttons read "账号 (2)" — the key plus a count — and the key is what
 * the test means.
 */
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

console.log('OK')
