/**
 * Smoke test for the dsh-localcoding-mcp client half, runnable without the
 * desktop app: stubs window/document/react/Cordis, applies the plugin, and
 * asserts the registration contract, the navigation tier, and zh/en key parity.
 *
 *   node test/localcoding-client.test.mjs dsh-localcoding-mcp/client.js
 */
import fs from 'node:fs'

const source = fs.readFileSync(process.argv[2], 'utf8')

/** Entry id, section id and patch row id must all match the plugin package. */
const ENTRY_ID = 'dsh-localcoding-mcp'
const SECTION_ID = 'localcoding-mcp'

/** Orders the host's own sections occupy; ours must sort after every one. */
const HOST_SECTION_ORDERS = { account: -10, general: 0, models: 10, plugins: 15, 'agent-presets': 20, 'im-bots': 21 }

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
  return new Function(`return ${source.slice(open, i + 1)}`)()
}
const en = dictionary('en')
const zh = dictionary('zh')
const missingInZh = Object.keys(en).filter((key) => !(key in zh))
const missingInEn = Object.keys(zh).filter((key) => !(key in en))
if (missingInZh.length > 0 || missingInEn.length > 0) {
  console.error('i18n key drift', { missingInZh, missingInEn })
  process.exit(1)
}
console.log(`i18n: ${Object.keys(en).length} keys, zh/en parity OK, nav=${zh.nav}`)

/* ── module registration ────────────────────────────────────────────────── */
globalThis.window = { __ModuleLoader__: { load: (registration) => { globalThis.__registration = registration } } }
globalThis.document = {
  head: { appendChild: (node) => { globalThis.__styles.push(node) } },
  createElement: () => ({ id: '', textContent: '' }),
  getElementById: () => null
}
globalThis.__styles = []
const pendingEffects = []
let effectsRun = false
const React = {
  createElement: (type, props, ...children) => ({ type, props, children: children.flat(Infinity) }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: (run) => { if (effectsRun) pendingEffects.push(run) },
  useCallback: (fn) => fn,
  useRef: (value) => ({ current: value })
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

/* ── apply() wiring ─────────────────────────────────────────────────────── */
const registered = { sections: [], dictionaries: [], forms: [] }
const ledger = {
  inject (_name, run) { const dispose = run(); return () => { dispose?.() } },
  register (entry, component) { registered.sections.push({ entry, component }); return () => {} }
}
const ctx = {
  slots: ledger,
  locale: {
    register: (ns, dict) => registered.dictionaries.push({ ns, dict }),
    bind: (ns) => (key) => `${ns}/${key}`
  },
  configForms: {
    get: (id) => {
      registered.forms.push(id)
      return { subscribe () {}, getSnapshot: () => ({}), mutate: async () => true }
    }
  },
  effect (fn) { fn() }
}
plugin.apply(ctx)

if (registered.dictionaries.length !== 1) throw new Error(`copy registered ${registered.dictionaries.length} times`)
if (registered.dictionaries[0].ns !== 'settings.localCodingMcp') throw new Error(`copy namespace is ${registered.dictionaries[0].ns}`)
if (registered.forms.length !== 1 || registered.forms[0] !== ENTRY_ID) {
  throw new Error(`configForms asked for ${registered.forms.join()} — expected ${ENTRY_ID}`)
}
if (registered.sections.length !== 1) throw new Error(`expected 1 settings section, got ${registered.sections.length}`)
const { entry, component } = registered.sections[0]
if (entry.name !== 'settings.section') throw new Error(`slot name is ${entry.name}`)
if (entry.id !== SECTION_ID) throw new Error(`section id is ${entry.id}`)
if (typeof entry.label !== 'function' || entry.label() !== 'settings.localCodingMcp/nav') throw new Error('label thunk missing')
if (globalThis.__styles.length !== 1 || globalThis.__styles[0].id !== 'dsh-localcoding-mcp-styles') throw new Error('style tag not installed')
const css = globalThis.__styles[0].textContent
if (css.includes('#fff') || css.includes('#000')) throw new Error('hard-coded colour survived in the stylesheet')
if (!css.includes('prefers-reduced-motion')) throw new Error('reduced-motion guard missing')

// The nav is the settings.section ledger sorted ascending: ours must land after
// every host page and stay last as the host ships more sections.
if (typeof entry.order !== 'number') throw new Error('section has no numeric order')
const hostMax = Math.max(...Object.values(HOST_SECTION_ORDERS))
if (entry.order <= hostMax) throw new Error(`order ${entry.order} collides with the host tier (max ${hostMax})`)

// Declared soft dependencies must cover every `ctx.*` the factory touches: an
// undeclared service throws "cannot get property ... without inject" and takes
// the whole client bundle down with it. `effect` is a context method, not a
// service, so it is not injectable.
const injected = new Set(plugin.inject)
const CONTEXT_METHODS = new Set(['effect', 'setTimeout', 'onDispose', 'setInterval'])
const declaredDeps = injected.has('configForms') && injected.has('locale') && injected.has('slots')
if (!declaredDeps) throw new Error(`inject list is ${[...injected].join()}`)
const usedServices = [...source.matchAll(/\bctx\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1])
const undeclared = [...new Set(usedServices.filter((name) => !injected.has(name) && !CONTEXT_METHODS.has(name)))]
if (undeclared.length > 0) throw new Error(`undeclared ctx usage: ${undeclared.join()}`)

// The plugin name must not be reused as the copy namespace: since host 0.1.7 the
// Settings section and the config form are both keyed by the entry id.
if (Object.keys(zh).includes(ENTRY_ID)) throw new Error('copy namespace collides with the entry id')
console.log(`section: id=${entry.id} order=${entry.order} inject=${[...injected].join()} ctx=${[...new Set(usedServices)].join()}`)

/* ── first paint ────────────────────────────────────────────────────────── */
effectsRun = true
globalThis.fetch = () => Promise.reject(new Error('no server in this test'))
const tree = component(entry.inject())
/**
 * Walk the rendered tree the way the host renderer would: function components
 * are not invoked here, so copy passed as a prop (`title`, `label`, `value`)
 * has to be collected alongside children.
 */
const SKIP_PROPS = new Set(['className', 'key', 'id', 'type', 'href', 'placeholder', 'disabled', 'danger'])
function texts (node, out = []) {
  if (node === null || node === undefined || node === false || node === true) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { node.forEach((child) => texts(child, out)); return out }
  if (node.children) texts(node.children, out)
  if (node.props) {
    for (const [key, value] of Object.entries(node.props)) {
      if (SKIP_PROPS.has(key)) continue
      // Props carry the copy a function component will render: `title` on a
      // card, `label`/`value` on a stat, and `actions` as a whole button row.
      texts(value, out)
    }
  }
  return out
}
const rendered = texts(tree).join(' | ')
// The cards have to be there on the first paint, before any status has
// arrived — the page is most useful while the server is still starting.
for (const needle of ['settings.localCodingMcp/heading', 'settings.localCodingMcp/server', 'settings.localCodingMcp/tools', 'settings.localCodingMcp/codex', 'settings.localCodingMcp/tunnel', 'settings.localCodingMcp/logs']) {
  if (!rendered.includes(needle)) throw new Error(`first paint is missing "${needle}"`)
}
// Every action button must be present on the first paint, before any status
// has arrived — the page has to be useful while the server is still starting.
for (const needle of ['settings.localCodingMcp/start', 'settings.localCodingMcp/stop', 'settings.localCodingMcp/restart', 'settings.localCodingMcp/registerCodex', 'settings.localCodingMcp/consent']) {
  if (!rendered.includes(needle)) throw new Error(`first paint is missing action "${needle}"`)
}
// The GPT-web card must render its own copy before any account is known,
// otherwise the "not enabled" explanation is unreachable.
for (const needle of ['settings.localCodingMcp/tunnelHint', 'settings.localCodingMcp/tunnelStartAll', 'settings.localCodingMcp/tunnelStopAll', 'settings.localCodingMcp/tunnelReadyzNote', 'settings.localCodingMcp/tunnelConnector']) {
  if (!rendered.includes(needle)) throw new Error(`tunnel card is missing "${needle}"`)
}
console.log(`paint: ${rendered.length} chars, all sections and actions present`)
console.log('OK')