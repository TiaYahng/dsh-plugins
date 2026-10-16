import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fork = fs.readFileSync(path.join(root, 'dsh-comprehensive-platform/vendor/our-free-model-client.js'), 'utf8')
const client = fs.readFileSync(path.join(root, 'dsh-comprehensive-platform/client.js'), 'utf8')

const must = ['function FreePage', 'CHANNEL_PROVIDERS', 'function SettingsPage', 'function ChannelsPage',
  'ofm_aurora', 'exports.renderSettings', 'function LedgerPage', 'function LogsPage', 'function GatewayPage',
  'function EacPage', 'function AggregatePage', 'function SaverPage', 'function RoutingPage']
const lost = must.filter((name) => fork.includes(name) === false)
console.log(lost.length === 0 ? 'fork keeps every page component' : `MISSING from the fork: ${lost.join(', ')}`)

console.log('free in the remembered list:', /const TABS = \['free'/.test(fork))
console.log('free in the nav:', fork.includes("nav.tab.free')"))
console.log('settings.section registered by the fork:', fork.includes("ctx.slots.inject('settings.section'"))
console.log('fork spliced into client.js:', client.includes("id: 'dsh-our-free-model-vendored'"))
console.log(`client.js: ${(client.length / 1024).toFixed(0)} KB`)

// My own FreeModel code must be gone, or it is dead weight in the bundle.
for (const name of ['function AccountsPage', 'function packBridge', 'function ModelCheck', 'dshFmTab', 'accounts.intro']) {
  if (client.includes(name)) console.log(`  !! still in client.js: ${name}`)
}
