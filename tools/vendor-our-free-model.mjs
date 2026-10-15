import fs from 'node:fs'
import path from 'node:path'

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

const root = 'E:/ai/dsh-plugins'
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

/* 7. The page is handed out instead. */
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

fs.mkdirSync(`${root}/dsh-desktop-platform/vendor`, { recursive: true })
fs.writeFileSync(`${root}/dsh-desktop-platform/vendor/our-free-model-client.js`, forked, 'utf8')

const clientFile = `${root}/dsh-desktop-platform/client.js`
const client = fs.readFileSync(clientFile, 'utf8')
const begin = '    /* >>> VENDOR:BEGIN */'
const end = '    /* <<< VENDOR:END */'
const from = client.indexOf(begin)
const to = client.indexOf(end)
if (from < 0 || to < 0) throw new Error('client.js has no VENDOR markers')
const spliced = client.slice(0, from + begin.length) + '\n' + forked + '\n' + client.slice(to)
fs.writeFileSync(clientFile, spliced, 'utf8')

console.log(`vendored ${(forked.length / 1024).toFixed(0)} KB with ${edits.length} edits:`)
for (const why of edits) console.log(`  · ${why}`)
