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
globalThis.window = {
  localStorage: { getItem: () => rememberedTab, setItem: () => {} },
  __ModuleLoader__: { load: (registration) => { globalThis.__registration = registration } }
}
globalThis.document = {
  head: { appendChild: (node) => styleTags.push(node) },
  createElement: () => ({ id: '', textContent: '' }),
  getElementById: () => null
}
const React = {
  // Flatten nested child arrays the way React does, so assertions can walk the
  // rendered tree without knowing which call site used `.map`.
  createElement: (type, props, ...children) => ({
    type,
    props,
    children: children.flat(Infinity)
  }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
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

// The nav is the settings.section ledger sorted ascending: ours must land after
// every host page, and stay last even if a future host release adds sections
// between the built-in tier and the installed third-party tier (IM机器人: 21).
const hostMax = Math.max(...Object.values(HOST_SECTION_ORDERS))
if (typeof entry.order !== 'number') throw new Error('section has no numeric order')
if (entry.order <= 100) throw new Error(`order ${entry.order} risks landing above a future host section (host max today ${hostMax})`)
console.log(`order: ${entry.order} (host pages max ${hostMax}, first installed third party 21)`)

const tree = component(entry.inject())
if (tree.type !== 'div' || tree.props.className !== 'dshPlatform') throw new Error('section root is not the platform shell')
const [tabBarElement, panelHost] = tree.children
// The first child is the TabBar component element; render it to reach its props.
const tabBar = tabBarElement.type(tabBarElement.props)
if (tabBar.props.role !== 'tablist') throw new Error('first child is not the tab strip')
if (tabBar.children.length !== 4) throw new Error(`expected 4 tabs, got ${tabBar.children.length}`)
const tabIds = tabBar.children.map((child) => child.props.id)
if (tabIds.join() !== 'dshPlatformTab-usage,dshPlatformTab-archive,dshPlatformTab-memory,dshPlatformTab-freemodel') {
  throw new Error(`tab ids: ${tabIds}`)
}
if (!tabBar.children.every((child) => child.props.role === 'tab' && child.props['aria-controls'].startsWith('dshPlatformPanel-'))) {
  throw new Error('tab wiring incomplete')
}
if (panelHost.props.className !== 'dshPlatformPanels') throw new Error('panel host missing')
const mounted = panelHost.children.filter(Boolean).map((panel) => panel.props.id)
if (mounted.join() !== 'usage') throw new Error(`only the remembered tab should mount, got ${mounted}`)
console.log(`apply: 1 section (${entry.id}), tabs ${tabIds.length}, initial panel ${mounted[0]}`)


// ── the foreign tab renders the other plugin's own section component ─────
// Remembering that tab is the only way to mount it: the panel mounts lazily.
rememberedTab = 'freemodel'
registered.sections.length = 0
plugin.apply(ctx)

// No owner in the ledger yet: the tab has to say so, not render a blank page.
let again = registered.sections[registered.sections.length - 1]
let withoutOwner = expand(again.component(again.entry.inject()))
let note = findByText(withoutOwner, 'settings.desktopPlatform/freemodel.missing')
if (note === null) throw new Error('foreign tab did not degrade to its missing-owner note')

// With the owner registered, the tab must render that plugin's own component.
const foreignComponent = (ownerProps) => ({ type: 'foreign-page', props: ownerProps })
ledgerEntries.length = 0
ledgerEntries.push({
  options: { id: 'our-free-model', order: 35, label: () => 'Our Free Model' },
  locale: 'dsh-our-free-model',
  component: foreignComponent
})
ledgerVersion += 1
registered.sections.length = 0
plugin.apply(ctx)
again = registered.sections[registered.sections.length - 1]
const withOwner = expand(again.component(again.entry.inject()))
const panel = findById(withOwner, 'dshPlatformPanel-freemodel')
if (panel === null) throw new Error('foreign tab did not mount its panel')
const rendered = findByType(panel, 'foreign-page')
if (rendered === null) throw new Error('foreign tab did not render the owner component')
if (typeof rendered.props.close !== 'function') throw new Error('foreign page needs a close affordance')
// The owner page reads `t` on its first line: without it the tab renders empty.
if (typeof rendered.props.t !== 'function') throw new Error('foreign page got no translator')
if (rendered.props.t('nav') !== 'dsh-our-free-model/nav') {
  throw new Error(`translator is not bound to the owner namespace: ${rendered.props.t('nav')}`)
}
// The owner's masthead is dropped inside this tab, and only inside it.
if (!source.includes('#dshPlatformPanel-freemodel .ofm_navbrand')) {
  throw new Error('owner masthead is not hidden inside this tab')
}
if (findByText(withOwner, 'settings.desktopPlatform/freemodel.missing') !== null) {
  throw new Error('foreign tab still claims the owner is missing')
}
console.log('foreign tab: owner component rendered, absent owner degrades to a note')

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
