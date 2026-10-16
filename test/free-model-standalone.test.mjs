import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The fourth tab must not need a second plugin.
 *
 * The page and its API used to live in dsh-our-free-model: install this plugin
 * alone and the tab was a dead frame. Its server now travels under free-model/,
 * so the things that could put the dependency back are all strings and switches
 * in this tree — which means they can be asserted.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const plugin = path.join(root, 'dsh-comprehensive-platform')
const read = (...parts) => fs.readFileSync(path.join(plugin, ...parts), 'utf8')

const server = read('free-model', 'server.js')
const store = read('free-model', 'src', 'store.js')
const client = read('client.js')
const entry = read('index.js')

const PREFIX = '/api/comprehensive-platform/free-model'

// One API, and it is ours.
if (server.includes('/api/our-free-model')) throw new Error('the vendored server still serves the owner prefix')
if (server.includes(`path: '${PREFIX}'`) === false) throw new Error('the vendored server does not mount our prefix')
if (server.includes(`'${PREFIX}/events'`) === false) throw new Error('the events stream stayed behind')
if (client.includes('api/our-free-model')) throw new Error('the page still asks the owner API')
if (client.includes(PREFIX.slice(1)) === false) throw new Error('the page does not ask our API')

// The handler strips its own prefix back off the pathname before comparing it
// to '/summary' and friends. There are two copies of that prefix on this path
// now — the one it registers and the one it strips — and only the first was
// moved. When they disagree every route falls through to 404, which reads
// exactly like "the tab has no data".
{
  const strips = [...server.matchAll(/pathname\.replace\((.+?),\s*''\)/g)].map((m) => m[1])
  for (const strip of strips) {
    if (strip.includes('our-free-model')) {
      throw new Error(`the handler still strips the owner prefix (${strip}); every route would 404`)
    }
    const re = new RegExp(strip.slice(1, strip.lastIndexOf('/')))
    if (re.test(PREFIX + '/summary') === false) {
      throw new Error(`the handler strips ${strip}, which does not match our prefix ${PREFIX}`)
    }
  }
  if (strips.length === 0) throw new Error('no prefix strip found; the check above is now vacuous')
}

// Its own state. Two writers on one catalog is how an install corrupts itself.
const dataDir = store.match(/DATA_DIR_NAME = '([^']+)'/)?.[1]
if (dataDir === undefined || dataDir === 'our-free-model') throw new Error('the vendored store kept the owner directory')
if (entry.includes('free-model/server.js') === false) throw new Error('this plugin does not load the vendored server')

// It must not rewrite the bytes it now lives inside. Their updater, their
// announcement feed and their hot reload all target an installed package; the
// mode that stands them down is the one a distribution pack uses, and it is
// switched on unconditionally so no call site can lose it.
if (/function distributionOf[\s\S]{0,400}return 'self'/.test(server)) {
  throw new Error('the vendored server can still take the self-updating path')
}
if (server.includes("if (true) return 'managed'") === false) {
  throw new Error('the vendored server is not pinned to managed')
}

// Provenance travels with the code: theirs, and the third-party upstream inside
// theirs.
for (const file of ['free-model/LICENSE', 'free-model/NOTICE.md',
  'free-model/vendor/channel-pack/LICENSE', 'free-model/vendor/channel-pack/NOTICE.md']) {
  if (fs.existsSync(path.join(plugin, ...file.split('/'))) === false) {
    throw new Error('missing provenance file: ' + file)
  }
}

// The pieces the server loads at runtime have to be present, and the browser
// half must not be vendored twice.
for (const file of ['free-model/src/store.js', 'free-model/src/http.js', 'free-model/adapter']) {
  if (fs.existsSync(path.join(plugin, ...file.split('/'))) === false) {
    throw new Error('missing vendored file: ' + file)
  }
}

// The channel pack is optional, on purpose. It carries a third party's Google
// OAuth credentials, so it is not in this repository; the machine that vendored
// it has it on disk, and a clone does not. Both states have to be supported, and
// the one that has to *work* is the one without it: their server treats the pack
// as an optional mount and reports why the channel list is empty.
const packPath = path.join(plugin, 'free-model/vendor/channel-pack/pack.js')
const hasPack = fs.existsSync(packPath)
if (hasPack === false) {
  const serverSource = fs.readFileSync(path.join(plugin, 'free-model', 'server.js'), 'utf8')
  if (/channelPack = \{ state: 'failed'/.test(serverSource) === false) {
    throw new Error('no pack and no degraded path: the fourth tab would break rather than report')
  }
  console.log('standalone: no channel pack here, and the server reports its absence instead of failing')
} else {
  const wasm = path.join(path.dirname(packPath), 'qoder-auth-wasm.wasm')
  if (fs.existsSync(wasm) === false) throw new Error('the pack is here without its wasm')
  console.log('standalone: the channel pack is present locally (kept out of the repository)')
}
if (fs.existsSync(path.join(plugin, 'free-model', 'client.js'))) {
  throw new Error('their client.js is vendored a second time on disk')
}

// `llm` stays a soft dependency: a host without the model plane loses the fourth
// tab, not the other three.
if (/export const inject = \[[^\]]*'llm'/.test(entry)) {
  throw new Error('llm became a hard dependency of the whole plugin')
}
if (entry.includes("ctx.inject(['llm']") === false) throw new Error('the vendored server is not mounted softly')

// When the pack is here at all, it has to be loadable exactly where their code
// looks for it: a dynamic import with a relative specifier, and its wasm beside
// itself by import.meta.url. That is why it keeps its upstream path rather than
// being tidied into place.
{
  const serverSource = fs.readFileSync(path.join(plugin, 'free-model', 'server.js'), 'utf8')
  const specifier = serverSource.match(/void import\('([^']+)'\)/)?.[1]
  if (specifier === undefined) throw new Error('the vendored server does not load the pack')
  const resolved = path.resolve(path.join(plugin, 'free-model'), specifier)
  if (fs.existsSync(resolved) === true) {
    console.log('standalone: the pack loads from the specifier their code uses (' + specifier + ')')
  }
}

// A copy of seventy files fails by missing one, and a missing module only says so
// when that code path first runs. Every *relative* import in the vendored tree is
// resolved here instead; bare specifiers are the host's own packages, which a
// profile does not install (they arrive through the host's loader), so they are
// counted rather than resolved.
{
  const walkFiles = (dir, out = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walkFiles(full, out)
      else if (/\.(js|mjs)$/.test(entry.name)) out.push(full)
    }
    return out
  }
  // Only the unbundled sources. channel-pack/pack.js is a 2.8 MB bundle: its
  // text still mentions paths that no longer exist (the TypeScript ones it was
  // built from) and its import specifiers were rewritten at build time, so a
  // scan of it finds ghosts. It is a single file — present means complete.
  const tree = [
    path.join(plugin, 'free-model', 'server.js'),
    ...walkFiles(path.join(plugin, 'free-model', 'src')),
    ...walkFiles(path.join(plugin, 'free-model', 'adapter'))
  ]
  let relative = 0
  let bare = 0
  const missing = []
  for (const file2 of tree) {
    const source = fs.readFileSync(file2, 'utf8')
    const specifiers = [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((match) => match[1])
    for (const specifier of specifiers) {
      if (specifier.startsWith('.') === false) { bare += 1; continue }
      relative += 1
      const resolved = path.resolve(path.dirname(file2), specifier)
      const candidates = [resolved, resolved + '.js', resolved + '/index.js']
      if (candidates.some((candidate) => fs.existsSync(candidate) === true) === false) {
        // The pack is optional and out of the repository; its absence is checked
        // above, against the path their code actually uses. Counting it as a
        // broken import here would fail every clone.
        if (specifier.includes('channel-pack') === false) {
          missing.push(path.relative(plugin, file2) + ' -> ' + specifier)
        }
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(`${missing.length} unresolvable import(s) in the vendored tree:\n  ${missing.join('\n  ')}`)
  }
  console.log(`standalone: every relative import in the vendored sources resolves (${relative} relative, ${bare} host-provided)`)
}

let bytes = 0
const walk = (dir) => {
  for (const entry2 of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry2.name)
    if (entry2.isDirectory()) walk(full)
    else bytes += fs.statSync(full).size
  }
}
walk(path.join(plugin, 'free-model'))
console.log('standalone: the fourth tab carries its own API (' + PREFIX + '), its own store, no updater')
console.log('standalone: free-model/ is ' + (bytes / 1024 / 1024).toFixed(1) + ' MB of theirs, with provenance')
console.log('OK')
