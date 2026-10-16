import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Vendor the owner's browser half into this plugin.
 *
 * The FreeModel pages are not re-implemented here any more: the original
 * source is taken as it is, patched in the places listed below, and spliced
 * into client.js between the VENDOR markers. What is left of my own FreeModel
 * code is deleted, because the point of vendoring is that their behaviour is
 * the behaviour.
 *
 *   node tools/vendor-our-free-model.mjs [--from <path to their client.js>]
 *
 * Every edit is matched by line and by content rather than by a block of
 * copied indentation: the source is theirs, and re-indenting it must not turn
 * this into a game of whitespace.
 */
const flagAt = process.argv.indexOf('--from')
const source = flagAt > 0
  ? process.argv[flagAt + 1]
  : path.join(process.env.APPDATA, 'dsh-desktop/harness/profiles/web/node_modules/dsh-our-free-model/client.js')
if (!fs.existsSync(source)) throw new Error(`no such source: ${source}`)

// The repository root is where this script lives, not a path anyone typed in:
// a machine-specific path in a script is a machine-specific path in the docs too.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const edits = []
let lines = fs.readFileSync(source, 'utf8').split('\n')

const indexOf = (needle, from = 0) => {
  const at = lines.findIndex((line, index) => index >= from && line.includes(needle))
  if (at < 0) throw new Error(`not found in the source: ${needle}`)
  return at
}
const note = (why) => edits.push(why)

/* 1. A distinct bundle id. The copy is evaluated through this plugin's own
      loader shim, so the host never sees it — but if it ever did, two bundles
      claiming one id would fight over one registration. */
lines[indexOf("id: 'dsh-our-free-model'")] = lines[indexOf("id: 'dsh-our-free-model'")]
  .replace("'dsh-our-free-model'", "'dsh-our-free-model-vendored'")
note('bundle id')

/* 2. The remembered page can no longer be the removed one. */
{
  const at = indexOf('const TABS = [')
  const inList = lines[at].includes("'free'")
  if (inList === false) throw new Error('the page list no longer names the removed page')
  lines[at] = lines[at].replace("'free', ", '')
  note('remembered pages')
}

/* 3. And there is no button for it either. */
{
  const at = indexOf("t('nav.tab.free')")
  if (lines[at].trim() === '') throw new Error('unexpected nav line')
  lines.splice(at, 1)
  note('nav entry')
}

/* 4. Its page is unreachable: the last branch is the default, so the removed
      page's component is never mounted. */
{
  const at = indexOf(': h(FreePage,')
  lines[at] = lines[at].replace('h(FreePage,', 'h(EacPage,')
  note('page switch default')
}

/* 5. This copy contributes a component, not a settings page. The platform owns
      the one section in the nav; registering a second here would put
      「Our Free Model」back in the settings sidebar, next to 「综合平台」. The
      first-run announcement goes with it: this plugin must not nag a user who
      never opened the owner's own page. */
{
  const from = indexOf("ctx.slots.inject('settings.section'")
  const last = indexOf('AnnouncementGate', from)
  lines.splice(from, last - from + 1,
    '      // Vendored: the platform renders this component inside its own section, so the',
    '      // two slot registrations that used to live here are gone. The first-run',
    '      // announcement goes with them — this plugin must not nag a user who never',
    '      // opened the owner\'s own page.')
  note('slot registrations')
}

/* 6. The announcement stream is the owner's own business. Their plugin already
      holds one EventSource for the whole app surface; a second one here would
      double the toasts and the OS notifications for the same feed.
      Anchored backwards from the effect that follows it: the phrase
      "push subscription" appears three times earlier in the file, and cutting
      from the first one deletes a third of the bundle. */
{
  const to = indexOf('reload notice')
  let from = to
  while (from > 0 && lines[from].includes('push subscription') === false) from -= 1
  if (from === 0 || to - from > 200) throw new Error(`the announcement stream block was not found (${from}..${to})`)
  lines.splice(from, to - from,
    '    // Vendored: the announcement stream is the owner\'s own. Their plugin holds',
    '    // one EventSource for the whole app surface, and this copy would double the',
    '    // toasts and the OS notifications for the same feed.')
  note('announcement stream (the owner keeps its own)')
}

/* 7. The dictionary registration is tolerant of the owner being present.
      Their own plugin registers `settings.ourFreeModel` too, and the host
      refuses a second registration for one namespace: the duplicate throws in
      the renderer, the client bundle fails to load, and the profile is declared
      broken — the app stops opening. The copy therefore registers only when
      nobody else has, which is also what makes it work on its own. */
{
  const at = indexOf('ctx.locale.register(NS,')
  if (lines[at].includes('try') === false) {
    lines[at] = lines[at].replace(
      "ctx.effect(() => ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en }), 'our-free-model: dictionaries')",
      "ctx.effect(() => {\n" +
      '        try {\n' +
      "          ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en })\n" +
      '        } catch (error) {\n' +
      "          // The owner's own plugin got here first. Its dictionary is the\n" +
      '          // same dictionary, so losing the race costs nothing; anything\n' +
      '          // else is a real failure and must surface.\n' +
      "          if (/already has locale/.test(String(error?.message ?? error)) === false) throw error\n" +
      '        }\n' +
      "      }, 'our-free-model: dictionaries')"
    )
  }
  note('dictionary registration is tolerant of the owner being installed')
}

/* 8. The page's own title row goes. It is the owner's name and mark, drawn
      above their tabs: right while their page was the page, wrong the moment the
      page became one tab inside 「综合平台」 — it is a second application
      announcing itself in the middle of this one. The star button shares that
      row, so it moves down onto the tab row rather than being thrown away: it
      is a link out, not branding. */
{
  const from = indexOf("className: 'ofm_navbrand'")
  const to = indexOf("t('title'))", from)
  if (lines[from].includes("h('span', { className: 'ofm_navbrand'") === false) {
    throw new Error('the title row does not start where I expected')
  }
  lines.splice(from, to - from + 1,
    '        // Vendored: the title row is gone. The platform owns the name of this page,',
    '        // and the owner\'s own mark above it read as a second application.')
  note('title row (the tabs are the whole bar now)')
}

/* 9. With the row gone the bar is one line: the tabs take the wide column and
      the star sits to their right. Left alone, the star would fall to a second
      row under the tabs, because the grid places it after a full-width item.
      The three rules that styled the removed row go with it — nothing draws
      those class names any more. */
{
  const at = indexOf('.ofm_tabs{position:relative;')
  lines[at] = lines[at].replace('grid-column:1 / -1;', 'grid-column:1;grid-row:1;')
  const star = indexOf('.ofm_starbtn{')
  lines[star] = lines[star].replace('{', '{grid-column:2;grid-row:1;')
  const dead = indexOf('.ofm_navbrand{')
  const last = indexOf('.ofm_navmark svg{', dead)
  lines.splice(dead, last - dead + 1)
  // The mark's own overrides, and the artwork itself: a 128px JPEG carried as
  // base64 in the bundle, referenced once — by the row that is no longer drawn.
  // The rule that also styles the channel logos is left alone; it is theirs.
  for (const selector of ['.ofm_root .ofm_navmark{', '.ofm_root .ofm_navmark svg{']) {
    const at2 = indexOf(selector)
    let end = at2
    while (lines[end].includes('}') === false) end += 1
    lines.splice(at2, end - at2 + 1)
  }
  const icon = indexOf('const BRAND_ICON =')
  const artwork = lines[icon].length
  lines.splice(icon, 1)
  console.log(`  (dropped ${(artwork / 1024).toFixed(0)} KB of brand artwork nobody draws)`)
  note('the star sits beside the tabs, not under them')
}

/* 10. EAC is the third tab. It was first, which made a lane the user has to sign
       into the first thing they see. `TABS` (what may be remembered) and the
       rendered list are moved together so the two cannot disagree, and the
       landing page follows the first tab: the old default named the removed
       page, so a first visit showed its content with no pill lit. */
{
  const at = indexOf('const TABS = [')
  const order = ['channels', 'aggregate', 'eac', 'saver', 'routing', 'ledger', 'logs', 'gateway']
  const current = [...lines[at].matchAll(/'([a-z]+)'/g)].map((match) => match[1])
  if (current.length !== order.length || current.includes('eac') === false) {
    throw new Error(`unexpected page list: ${current.join(', ')}`)
  }
  // The quotes are part of the text being matched, not part of the ids.
  const quoted = (ids) => ids.map((id) => `'${id}'`).join(', ')
  if (lines[at].includes(quoted(current)) === false) {
    throw new Error(`the page list does not read as expected: ${lines[at].trim()}`)
  }
  lines[at] = lines[at].replace(quoted(current), quoted(order))

  const rendered = indexOf('const tabs = [')
  const entry = lines[rendered + 1]
  if (entry.includes("'eac'") === false) throw new Error('EAC is not the first rendered tab')
  lines.splice(rendered + 1, 1)
  // Third, counted from the first tab that is left.
  lines.splice(rendered + 3, 0, entry)

  for (const fallback of ['? saved : \'free\'', 'catch { return \'free\' }']) {
    const at2 = indexOf(fallback)
    lines[at2] = lines[at2].replace(fallback, fallback.replace("'free'", 'TABS[0]'))
  }
  note('EAC is the third tab; the landing page follows the first')
}

/* 11. The announcement panel goes. Two pages carry one: EAC and 网关设置, each as
      a section at the bottom called 「公告中心」 with 展开 / 检查新公告 buttons. It
      reads the owner's announcement feed, which this copy does not even hold a
      stream for any more, so the panel can only ever show its empty state — and
      a page about models has no business carrying a noticeboard about the
      plugin. The component goes with it, so the page stops asking for the feed
      at all. */
{
  const needle = "h(Section, { title: t('section.news'), hint: t('section.newsHint') }, h(NewsPanel, { t }))"
  const spots = lines.map((line, index) => (line.includes(needle) ? index : -1)).filter((index) => index >= 0)
  if (spots.length !== 2) throw new Error(`the news panel is on ${spots.length} pages, expected 2`)
  // One of the two is the last thing in its page and closes that page's own
  // call, so its trailing parens have to stay — deleting the line outright
  // leaves the outer call open. The other is one section among several and its
  // whole line goes. From the back, so the earlier line numbers stay true.
  for (const at of spots.reverse()) {
    const tail = lines[at].slice(lines[at].indexOf(needle) + needle.length)
    if (tail === ',') {
      lines.splice(at, 1)
      continue
    }
    if (/^\)+$/.test(tail) === false) {
      throw new Error(`the news panel is not on a line of its own: ...${tail}`)
    }
    lines[at] = ' '.repeat(lines[at].search(/\S/)) + tail
  }
  if (lines.some((line) => line.includes('h(NewsPanel,'))) {
    throw new Error('a news panel survived')
  }

  // The components themselves, and nothing else references them. Indentation
  // cannot find a function's end: the bundle is one indented factory, so the
  // closing brace sits at the same indent as the body. The end is the next
  // declaration at that level, which must be preceded by a lone `}` and a blank
  // line — or this has cut a function in half.
  const dropComponent = (definition) => {
    const at2 = indexOf(definition)
    const indent = ' '.repeat(lines[at2].search(/\S/))
    const declaration = new RegExp('^' + indent + '(function|const|let|var|class)\\s')
    let end = at2 + 1
    while (end < lines.length && declaration.test(lines[end]) === false) end += 1
    if (end === lines.length) throw new Error(`${definition} never ends`)
    // The closing brace is the last thing before the blank line and whatever
    // banner comment labels the next block.
    let brace = end - 1
    while (/^(\s*$|\s*(\/\/|\/\*))/.test(lines[brace])) brace -= 1
    if (lines[brace].trim() !== '}') {
      throw new Error(`${definition} does not close before: ${lines[end].trim()}`)
    }
    lines.splice(at2, brace - at2 + 1)
  }
  dropComponent('function NewsPanel(props)')
  // The panel was the only thing that drew one announcement; the renderer for
  // a single announcement goes with it.
  if (lines.some((line) => line.includes('h(NewsItem,') === false) === true) {
    dropComponent('function NewsItem(props)')
  }
  note('announcement panel (its feed belongs to the owner, not to this page)')
}

/* 12. The page asks our own API. The browser half used to address the owner's
      server; the server half now travels with this plugin (see the phase below),
      on a prefix of its own, so the page has to ask for it there. Two lines carry
      the prefix: the header comment that documents the transport, and the resolved
      base with its fallback for a missing base URI. */
{
  const at = indexOf("new URL('api/our-free-model'")
  let replaced = 0
  const swap = (line) => line.replace(/api\/our-free-model/g, () => {
    replaced += 1
    return 'api/comprehensive-platform/free-model'
  })
  lines[at] = swap(lines[at])
  // The doc comment above it, so the transport this page uses is not a lie.
  const comment = indexOf('the plugin\'s own same-origin')
  lines[comment] = swap(lines[comment])
  if (replaced !== 3) throw new Error(`expected three API strings, found ${replaced}`)
  note('the page asks our API, not another plugin\'s')
}

/* 13. The page is handed out instead. */
{
  const at = indexOf('exports.apply = apply')
  const indent = ' '.repeat(lines[at].search(/\S/))
  lines.splice(at, 0,
    `${indent}// The component the platform mounts. Everything it needs — data, copy, the`,
    `${indent}// channel bridge — it fetches itself, exactly as it did in its own page.`,
    `${indent}exports.renderSettings = (props, owner) => h(SettingsPage, { ...props, locale: localeTag(owner), ctx: owner })`)
  note('component export')
}

const header = `/* ══ vendored: dsh-our-free-model, browser half ══════════════════════════════
   Taken from the owner's own client.js and patched in ${edits.length} places:
${edits.map((why) => `     · ${why}`).join('\n')}
   Regenerate with:  node tools/vendor-our-free-model.mjs
   Edit the fork, not the original: the next run reads the original wholesale. */
`
const forked = `${header}${lines.join('\n')}`

fs.mkdirSync(`${root}/dsh-comprehensive-platform/vendor`, { recursive: true })
fs.writeFileSync(`${root}/dsh-comprehensive-platform/vendor/our-free-model-client.js`, forked, 'utf8')

const clientFile = `${root}/dsh-comprehensive-platform/client.js`
const client = fs.readFileSync(clientFile, 'utf8')
const begin = '    /* >>> VENDOR:BEGIN */'
const end = '    /* <<< VENDOR:END */'
const from = client.indexOf(begin)
const to = client.indexOf(end)
if (from < 0 || to < 0) throw new Error('client.js has no VENDOR markers')
const spliced = client.slice(0, from + begin.length) + '\n' + forked + '\n' + client.slice(to)
fs.writeFileSync(clientFile, spliced, 'utf8')

/* ── the server half ─────────────────────────────────────────────────────────
   The page needs an API and this copy used to borrow someone else's. That is
   exactly the external condition that makes a plugin not standalone: install
   ours and the fourth tab is dead until a second plugin shows up. So the server
   comes along too — same rule as the browser half: take their source as it is,
   patch the handful of places where it believes it owns the machine, and say so.

   What is patched, and why each one is required rather than tidy:

     1. the route prefix. `/api/our-free-model` exists only in their index.js, so
        one replacement moves the whole API. It has to move: two plugins serving
        one prefix would fight, and their own installer may be sitting right
        next to this one.
     2. the data directory. Two writers on one store is how an install corrupts
        itself — their own comments say so about their bytes; the same applies to
        their catalog. Ours is its own directory.
     3. the updater, the announcement channel and the hot reload stand down.
        Their code already has a mode for exactly this case — a distribution pack
        owning the bytes — and it is switched on here unconditionally, so the
        property does not depend on what the call site passes.
     4. the version string, which they read from their own package.json. There is
        none in this tree; ours answers instead, so `/summary` reports something
        true.
     5. the module's own file name, for the reload path that managed mode never
        takes.

   Their `src/`, the absorbed channel pack (a third-party upstream's copy, with
   its own MIT LICENSE and NOTICE, kept as they are) and their LICENSE come
   across untouched.
 */
const API_PREFIX = '/api/comprehensive-platform/free-model'
const upstreamDir = path.dirname(source)
const freeModelDir = `${root}/dsh-comprehensive-platform/free-model`
const serverEdits = []
const serverNote = (why) => serverEdits.push(why)

const copyTree = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.cpSync(from, to, { recursive: true })
}
const copyFile = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
}

// Their browser half is already inlined in client.js; the rest of the tree is
// what the server needs at runtime. The pack keeps its own path — their code
// loads it with a dynamic import of `./vendor/channel-pack/pack.js`, and pack.js
// finds the wasm next to itself by import.meta.url — so moving it would be a
// patch that exists only to be undone by the next person reading the diff.
fs.rmSync(freeModelDir, { recursive: true, force: true })
copyTree(`${upstreamDir}/src`, `${freeModelDir}/src`)
copyTree(`${upstreamDir}/vendor/channel-pack`, `${freeModelDir}/vendor/channel-pack`)
copyTree(`${upstreamDir}/adapter`, `${freeModelDir}/adapter`)
copyTree(`${upstreamDir}/locale`, `${freeModelDir}/locale`)
copyFile(`${upstreamDir}/LICENSE`, `${freeModelDir}/LICENSE`)

/* 1-2, 4-5: their index.js, as `server.js`. */
{
  const at = `${freeModelDir}/server.js`
  let server = fs.readFileSync(`${upstreamDir}/index.js`, 'utf8')
  const swap = (from, to, why) => {
    if (server.includes(from) === false) throw new Error(`the server half does not contain: ${from.slice(0, 60)}`)
    server = server.replace(from, to)
    serverNote(why)
  }
  swap("path: '/api/our-free-model'", `path: '${API_PREFIX}'`, 'the API prefix is ours')
  swap("'/api/our-free-model/events'", `'${API_PREFIX}/events'`, 'the events route moves with it')
  // The handler strips its own prefix off `url.pathname` before matching
  // '/summary' and the rest. It is a second copy of the same string, so
  // moving only the mount leaves every route falling through to 404 — which
  // looks like "the tab has no data", not like a rename that missed a spot.
  swap('/^\\/api\\/our-free-model/', `/^\\${API_PREFIX.replace(/\//g, '\\/')}/`, 'the handler strips our prefix too')
  swap(`'our-free-model: settings API mounted at /api/our-free-model'`, `'dsh-comprehensive-platform: free-model API mounted at ${API_PREFIX}'`, 'the mount log names the new prefix')
  swap("path.join(PKG_DIR, 'package.json')", "path.join(PKG_DIR, '..', 'package.json')", 'the reported version is this plugin\'s')
  swap("new URL('index.js', import.meta.url)", "new URL('server.js', import.meta.url)", 'the reload entry point is this file')
  swap(' * @module index.js', ' * @module free-model/server.js (vendored from dsh-our-free-model)', 'the module header says where it came from')
  fs.writeFileSync(at, server, 'utf8')
}

/* 3: managed, unconditionally. */
{
  const at = `${freeModelDir}/server.js`
  let server = fs.readFileSync(at, 'utf8')
  const from = `function distributionOf(config, settings) {
  if (config?.distribution === 'managed' || settings.get().distribution === 'managed') return 'managed'`
  const to = `function distributionOf(config, settings) {
  // Vendored: always managed. Their updater rewrites the installed package from
  // their repository, their announcement channel publishes their feed, and their
  // hot reload replaces their own module — all three would be writing to this
  // plugin's bytes, which are ours. 'managed' is the mode they built for a
  // distribution pack that owns the bytes, so it is the right one here, and it
  // is unconditional so the property cannot be lost by a call site.
  void config
  void settings
  if (true) return 'managed'`
  if (server.includes(from) === false) throw new Error('the distribution switch moved')
  fs.writeFileSync(at, server.replace(from, to), 'utf8')
  serverNote('self-update, announcements and hot reload stand down')
}

/* The store lives beside the harness home, under a name of its own. */
{
  const at = `${freeModelDir}/src/store.js`
  const store = fs.readFileSync(at, 'utf8')
  const from = "export const DATA_DIR_NAME = 'our-free-model'"
  if (store.includes(from) === false) throw new Error('the data directory name moved')
  fs.writeFileSync(at, store.replace(from, "export const DATA_DIR_NAME = 'comprehensive-platform'"), 'utf8')
  serverNote('its own data directory')
}

fs.writeFileSync(`${freeModelDir}/NOTICE.md`, `# free-model/ — vendored

The browser half lives inside client.js between the VENDOR markers; this
directory is its server half. Both come from **dsh-our-free-model** (MIT), taken
as they are and patched only where the code believed it owned the machine:

| Where | What | Why |
| --- | --- | --- |
| server.js | API prefix → ${API_PREFIX} | two plugins must not serve one prefix |
| server.js | the handler's own prefix strip → ${API_PREFIX} | the mount and the strip are two copies of one string; moving only the mount 404s every route |
| server.js | distributionOf → always managed | its updater, announcement feed and hot reload rewrite the installed package, which is this plugin's bytes |
| server.js | version read from the parent package.json | there is no package.json of its own here |
| src/store.js | DATA_DIR_NAME → comprehensive-platform | two writers on one catalog corrupt it |

Everything under src/ and vendor/ is theirs, unmodified. vendor/channel-pack/ is
in turn a complete copy of a third-party upstream — see channel-pack/NOTICE.md,
which names it and its licence. The LICENSE next to this file is theirs.

`, 'utf8')
serverNote('provenance recorded next to the copy')

const serverBytes = (function total(dir) {
  let sum = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    sum += entry.isDirectory() ? total(full) : fs.statSync(full).size
  }
  return sum
})(freeModelDir)
console.log(`vendored server ${(serverBytes / 1024 / 1024).toFixed(1)} MB with ${serverEdits.length} edits:`)
for (const why of serverEdits) console.log(`  · ${why}`)

console.log(`vendored ${(forked.length / 1024).toFixed(0)} KB with ${edits.length} edits:`)
for (const why of edits) console.log(`  · ${why}`)
