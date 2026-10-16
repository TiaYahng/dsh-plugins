import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A schema call that does not exist throws while the module is being evaluated,
 * which takes the whole client bundle down: the app refuses to start, and the
 * plugin it names is whichever one happened to be loaded last. Both plugins here
 * have shipped that shape at least once.
 *
 * So every `z.<name>(` in every source is checked against the exports of the
 * schemastery this machine resolves, snapshotted beside this test the way the
 * host's own tokens are. Comments are stripped first: the line that documents
 * why `z.enum` is not used mentions it in prose, and matching that would report
 * the fix as the fault.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const snapshotFile = path.join(root, 'test', 'schemastery-exports.json')

// Refreshed by hand from the profile: the package is a peer dependency, so a
// checkout does not have it installed and cannot enumerate it for itself.
const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'))
const available = new Set(snapshot.exports)
console.log(`schemastery ${snapshot.version}: ${available.size} exports (snapshot)`)

const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory() || entry.isSymbolicLink()) walk(full, out)
    else if (/\.(js|mjs)$/.test(entry.name)) out.push(full)
  }
  return out
}

const plugins = ['dsh-comprehensive-platform', 'dsh-localcoding-mcp']
let scanned = 0
for (const plugin of plugins) {
  const dir = path.join(root, plugin)
  if (fs.existsSync(dir) === false) { console.log(plugin + ': not here, skipped'); continue }
  // The vendored copy is theirs and is checked by its own test; what matters
  // here is the code this repository writes.
  const files = walk(dir).filter((file) => file.includes('free-model') === false)
  const missing = new Map()
  for (const file of files) {
    const text = stripComments(fs.readFileSync(file, 'utf8'))
    for (const match of text.matchAll(/\bz\.(\w+)\s*\(/g)) {
      if (available.has(match[1])) continue
      if (missing.has(match[1]) === false) missing.set(match[1], path.relative(root, file))
    }
  }
  scanned += files.length
  if (missing.size > 0) {
    for (const [name, where] of missing) console.log(`  MISSING z.${name}  first in ${where}`)
    throw new Error(`${plugin}: ${missing.size} schemastery call(s) this version does not have`)
  }
  console.log(`${plugin}: ${files.length} files, every z.* call exists`)
}

// Two more module-scope shapes that have cost this machine an app that would not
// start. They are cheap to state and cheap to keep stated.
const client = fs.readFileSync(path.join(root, 'dsh-comprehensive-platform/client.js'), 'utf8')
if (/ctx\.locale\b/.test(client.replace(/\/\*[\s\S]*?\*\//g, '')) && !/const inject = \[[^\]]*'locale'/.test(client)) {
  throw new Error('the client reads ctx.locale without declaring it in inject')
}
console.log(`OK · ${scanned} files scanned`)