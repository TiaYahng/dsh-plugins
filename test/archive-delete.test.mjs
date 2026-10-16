/**
 * Archive-tab delete tests.
 *
 * The archive tab is the one surface where a button can permanently destroy
 * data, and it cannot be exercised from outside the app — so the section is
 * mounted here against a tiny stateful React stand-in, the buttons are clicked
 * for real, and the Host `session.delete` calls are recorded.
 */
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../dsh-comprehensive-platform/client.js', import.meta.url), 'utf8')

let failures = 0
function check (name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) return console.log(`  ok   ${name}`)
  failures += 1
  console.error(`  FAIL ${name}\n       actual   ${a}\n       expected ${e}`)
}

/* ── dictionaries straight out of the source text ──────────────────────── */
function dictionary (name) {
  const start = source.indexOf(`const ${name} = {`)
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
const copy = { zh: dictionary('zh'), en: dictionary('en') }
const t = (key, values) => {
  const template = copy.zh[key] ?? copy.en[key]
  if (template === undefined) throw new Error(`missing copy key ${key}`)
  return template.replace(/\{(\w+)\}/g, (whole, name) => (values !== undefined && name in values ? String(values[name]) : whole))
}

/* ── environment ───────────────────────────────────────────────────────── */
const TAB_KEY = 'dshDesktopPlatformTab'
const state = { tab: 'archive' }
globalThis.window = {
  localStorage: {
    getItem: (key) => (key === TAB_KEY ? state.tab : null),
    setItem: (key, value) => { if (key === TAB_KEY) state.tab = value }
  },
  __ModuleLoader__: { load: (registration) => { globalThis.__registration = registration } }
}
globalThis.document = {
  head: { appendChild: () => {} },
  // Enough of an element for a plugin to style: the vendored FreeModel page
  // sets a data-plugin attribute and a text content on its stylesheet.
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

/** The archive listing the stubbed fetch serves; tests mutate it. */
const listing = { sessions: [
  { sessionId: 's1', title: '第一条', updatedAt: 1750000000000 },
  { sessionId: 's2', title: '', updatedAt: 1750000001000 }
] }
let listCalls = 0
globalThis.fetch = async (path) => {
  if (path.includes('archive.list')) {
    listCalls += 1
    return { ok: true, status: 200, json: async () => ({ sessions: listing.sessions }) }
  }
  throw new Error(`unexpected fetch ${path}`)
}

/* ── a stateful React stand-in ─────────────────────────────────────────── */
function createRenderer () {
  const slots = []
  const effects = []
  const memo = []
  let cursor = 0
  const sameDeps = (a, b) => {
    if (a === undefined || b === undefined) return false
    if (a.length !== b.length) return false
    return a.every((value, index) => value === b[index])
  }
  const React = {
    createElement: (type, config, ...children) => ({ type, props: config ?? {}, children: children.flat(Infinity) }),
    useState (initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next }]
    },
    // Dependency tracking, so an effect with a stable `useCallback` dep runs once
    // instead of on every draw — without it the panel's fetch would restart
    // forever and the view would never settle.
    useEffect (fn, deps) {
      const index = cursor++
      const previous = memo[index]
      if (previous === undefined || !sameDeps(previous.deps, deps)) {
        effects.push(previous === undefined ? fn : () => { previous.dispose?.(); return fn() })
        memo[index] = { deps, dispose: undefined }
      }
    },
    useCallback (fn, deps) {
      const index = cursor++
      const previous = memo[index]
      if (previous === undefined || !sameDeps(previous.deps, deps)) memo[index] = { deps, value: fn }
      return memo[index].value
    },
    useRef: (value) => ({ current: value }),
    useSyncExternalStore: () => ({ value: {}, revision: 0, writable: true, status: 'ready' })
  }
  const render = () => {
    cursor = 0
    effects.length = 0
    return React
  }
  return { React, slots, effects, memo, render }
}

function walk (node, visit) {
  if (node === null || node === undefined || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  visit(node)
  walk(node.children, visit)
}
const text = (node) => (typeof node === 'string' ? node : null)
function findByText (tree, needle) {
  let hit = null
  walk(tree, (node) => {
    if (hit === null && node.children.some((child) => text(child) === needle)) hit = node
  })
  return hit
}
function findAllByText (tree, needle) {
  const hits = []
  walk(tree, (node) => { if (node.children.some((child) => text(child) === needle)) hits.push(node) })
  return hits
}
function findInputs (tree) {
  const found = []
  walk(tree, (node) => { if (node.type === 'input') found.push(node) })
  return found
}

/** The open modal, so its buttons are never confused with the ones behind it. */
function findDialog (tree) {
  let hit = null
  walk(tree, (node) => { if (hit === null && node.props.role === 'dialog') hit = node })
  return hit
}

/* ── mount the section, exactly as the Settings page would ─────────────── */
const renderer = createRenderer()
new Function('window', 'document', 'React', 'require', source)(
  globalThis.window, globalThis.document, renderer.React, () => { throw new Error('unused') }
)
const plugin = globalThis.__registration.factory(() => renderer.React)

const calls = []
let deleteBehaviour = async (request) => { calls.push(request); return { deleted: true } }
let section = null
const ctx = {
  slots: {
    inject (_name, run) { run() },
    register (entry, component) { if (entry.id === 'desktop-platform') section = { entry, component } }
  },
  locale: { register: () => {}, bind: () => (key, values) => t(key, values) },
  configForms: { get: () => ({ subscribe () {}, getSnapshot: () => ({}), mutate: async () => true }) },
  effect (fn) { fn() },
  // The soft block that supplies the Host session remote.
  inject (names, run) {
    if (names.join(',') === 'remote,remote.session') {
      run({ remote: { session: { delete: (request) => deleteBehaviour(request) } } })
    }
  }
}
plugin.apply(ctx)
if (section === null) throw new Error('section did not register')

/**
 * Expand function-typed elements the way a renderer would, in depth-first order
 * so the shared hook slots line up with React's own ordering.
 */
const expand = (node) => {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(expand).flat(Infinity)
  if (typeof node.type === 'function') {
    // Children live outside props in this stand-in; a component reads them off
    // props, exactly as React passes them.
    const children = node.children.length === 1 ? node.children[0] : node.children
    return expand(node.type({ ...node.props, children }))
  }
  return { ...node, children: (node.children ?? []).map(expand).flat(Infinity) }
}

let view = null
const renderView = () => {
  renderer.render()
  view = expand(section.component(section.entry.inject()))
  // Effect cleanups are deliberately never invoked: this stand-in has no
  // unmount, and running a cleanup on a plain re-render would trip the panels'
  // "disposed" guards that exist for real unmounts.
  for (const effect of renderer.effects) effect()
}
const settle = async (rounds = 6) => {
  for (let round = 0; round < rounds; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    renderView()
  }
  // The stand-in has no dependency tracking, so every render re-runs effects:
  // the last async state write lands after the final render. Draw once more.
  await new Promise((resolve) => setTimeout(resolve, 0))
  renderView()
}

/* ── 1. the listing renders with per-row and batch controls ────────────── */
renderView()
await settle()
check('two archived rows are listed', findAllByText(view, '第一条').length, 1)
check('untitled row falls back', findAllByText(view, t('archive.untitled')).length, 1)
check('each row has a delete button', findAllByText(view, t('archive.delete')).length, 2)
// The toolbar offers a labelled select-all; the table header repeats it as a
// bare checkbox, so the count is by input: toolbar + header + one per row.
check('four checkboxes: toolbar, header, two rows', findInputs(view).length, 4)
check('toolbar labels its select-all', findAllByText(view, t('archive.selectAll')).length, 1)
check('no batch bar before a selection', findByText(view, t('archive.clearSelection')), null)

/* ── 2. single delete goes through the Host remote ─────────────────────── */
findAllByText(view, t('archive.delete'))[0].props.onClick()
renderView()
check('confirm dialog opens', findByText(view, t('archive.deleteOneTitle')) !== null, true)
check('dialog names the session', findByText(view, '第一条') !== null, true)
findByText(findDialog(view), t('archive.confirmDelete')).props.onClick()
await settle()
check('Host delete called once with that id', calls, [{ sessionId: 's1' }])

/* ── 3. a failing delete surfaces the message and deletes nothing more ─── */
listing.sessions = [{ sessionId: 's1', title: '第一条', updatedAt: 1750000000000 }]
deleteBehaviour = async () => { throw new Error('busy') }
calls.length = 0
renderView()
await settle()
findAllByText(view, t('archive.delete'))[0].props.onClick()
renderView()
findByText(findDialog(view), t('archive.confirmDelete')).props.onClick()
await settle()
check('failure message is shown', findByText(view, t('archive.deleteFailed', { message: 'busy' })) !== null, true)
check('no further Host calls after the failure', calls, [])

/* ── 4. batch delete: select all, confirm once, one Host call per row ──── */
listing.sessions = [
  { sessionId: 's1', title: '第一条', updatedAt: 1750000000000 },
  { sessionId: 's2', title: '第二条', updatedAt: 1750000001000 }
]
deleteBehaviour = async (request) => { calls.push(request); return { deleted: true } }
calls.length = 0
renderView()
await settle()
// The tab only re-reads on demand, so refresh the way a user would after
// archiving more sessions elsewhere.
findByText(view, t('archive.refresh')).props.onClick()
await settle()
findInputs(view)[0].props.onChange()
renderView()
check('batch button counts the selection', findByText(view, t('archive.deleteSelected', { count: 2 })) !== null, true)
check('selection counter is announced', findByText(view, t('archive.selected', { count: 2 })) !== null, true)
findByText(view, t('archive.deleteSelected', { count: 2 })).props.onClick()
renderView()
check('batch dialog names the count', findByText(view, t('archive.deleteManyTitle', { count: 2 })) !== null, true)
check('dialog lists the sessions', findByText(view, '第二条') !== null, true)
findByText(findDialog(view), t('archive.confirmDelete')).props.onClick()
await settle()
check('one Host call per row, in listing order', calls, [{ sessionId: 's1' }, { sessionId: 's2' }])
check('the listing was re-read after deleting', listCalls >= 4, true)

if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
console.log('archive delete: all checks passed')