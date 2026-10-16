/**
 * Platform page for DSH Desktop: one Settings section holding three tabs.
 *
 * Everything upstream makes available to a local plugin is used here — the
 * stored-log reader for token accounting, the workspace registry for archives
 * and per-workspace files, `webServer.register` for the loopback routes — so a
 * Harness rebuild does not have to be re-derived against a rewritten bundle.
 *
 * Three surfaces, one page:
 *
 * - **用量统计** — Harness keeps token accounting inside each session's
 *   durable event log (every `assistant/message` carries the usage its adapter
 *   reported) and ships nothing that adds those records up. `server/usage.js`
 *   folds the stored logs into totals, per-model and per-day breakdowns, and a
 *   credit conversion the user configures (credits are a conversion, never a
 *   billed figure — the desktop cannot know a deployment's price list).
 * - **归档历史** — upstream archives a session durably but ships no way back:
 *   the registry has `archiveSession` and `forgetSession` (permanent delete)
 *   and nothing between. `server/archive.js` adds restore, and lists the
 *   workspaces the memory tab's picker needs.
 * - **记忆系统** — `MEMORY.md` per workspace root is the long-term memory file
 *   the harness ingests as workspace instructions, plus a marked convention
 *   block in `AGENTS.md` that tells the agent to maintain it, plus the handoff
 *   note a finished conversation leaves behind (`server/memory.js`).
 *
 * Every route is loopback-only and every workspace-bound path is confined to
 * the registry's own roots. Nothing here writes to a session.
 *
 * @module dsh-comprehensive-platform
 */
import z from '@deepseek-ai/schemastery'

import { createRouteTable } from './server/http.js'
import { readQuota, registerUsageRoutes, SUMMARY_PATH } from './server/usage.js'
import { registerArchiveRoutes, LIST_PATH, WORKSPACES_PATH } from './server/archive.js'
import { registerMemoryRoutes, MEMORY_PATH, CONVENTION_PATH, HANDOFF_PATH } from './server/memory.js'
import * as freeModel from './free-model/server.js'

/** Stable Cordis plugin name (also the id used in the Desktop patch row). */
export const name = 'dsh-comprehensive-platform'

/**
 * The stored-log reader and the workspace registry this plugin serves from.
 *
 * Declared together on purpose: one entry owns one Settings page, and that page
 * needs both. A profile without a workspace registry loses the archive and
 * memory tabs along with the statistics tab rather than half of each.
 */
export const inject = ['sessionPersistence', 'workspaceRegistry']

export { SUMMARY_PATH, LIST_PATH, WORKSPACES_PATH, MEMORY_PATH, CONVENTION_PATH, HANDOFF_PATH }
export { collectSummary, creditSummary, foldEvents } from './server/usage.js'
export { collectArchive, collectWorkspaces } from './server/archive.js'
export { readMemory, writeMemory, writeConvention, readHandoff, writeHandoff, summarizeHandoff } from './server/memory.js'

/**
 * Settings namespace holding the credit-conversion and quota fields.
 *
 * Since 0.1.7 a settings section **is** the owning Loader entry: upstream
 * derives the form from the entry's `Config` schema and keys it by the entry id
 * (`SettingsForms.describe` → `ns: entry.options.id`). The old free-standing
 * `ctx.settings.register(namespace, schema)` registry is gone, so this must stay
 * equal to the patch row id or the page has no form at all.
 */
export const SETTINGS_NAMESPACE = name

/**
 * Credit conversion and quota. All three default to `0`, which leaves the page
 * showing raw tokens only: the desktop cannot know a deployment's price list,
 * so any credit figure is a conversion the user chose, not a billed fact.
 *
 * Exporting this is what makes the section configurable — upstream projects
 * exactly this schema into the Settings page, so the values below are the ones
 * the resolved `config` argument carries and the ones the page edits.
 */
export const Config = z.object({
  creditsPerMillionInput: z.number().default(0),
  creditsPerMillionOutput: z.number().default(0),
  quotaCredits: z.number().default(0)
})

/**
 * Register every route this page reads and writes.
 * @param ctx - Host context carrying `sessionPersistence`, `workspaceRegistry`
 *   and — when the HTTP host is mounted — `webServer`.
 * @param config - This plugin's resolved `Config`, supplied by the Loader.
 */
export function apply(ctx, config) {
  const cache = new Map()
  // The handoff summary must reach the LLM runtime, but reading `ctx.llm`
  // without declaring the dependency throws, and adding `llm` to this plugin's
  // `inject` would mean no route mounts whenever the plane is absent. Capture
  // the runtime when the plane appears and let the probe degrade to
  // `runtime-unavailable` until then.
  let llm = undefined
  ctx.inject(['llm'], (plane) => { llm = plane.llm })
  ctx.inject(['webServer'], (webCtx) =>
    webCtx.effect(() => {
      const table = createRouteTable(webCtx)
      registerUsageRoutes(table, webCtx, ctx.sessionPersistence, readQuota(config), cache)
      registerArchiveRoutes(table, webCtx, ctx.workspaceRegistry)
      registerMemoryRoutes(table, webCtx, ctx.workspaceRegistry, llm)
      return () => {
        table.dispose()
        cache.clear()
      }
    }, 'dsh-comprehensive-platform: platform routes')
  )

  // The fourth tab's server, vendored from dsh-our-free-model.
  //
  // It used to live in that plugin, which made this plugin depend on somebody
  // else's being installed: ours alone gave you three tabs and a dead fourth. The
  // copy under free-model/ is patched to serve this plugin's API prefix, to keep
  // its own data directory, and to stand down its updater, announcement feed and
  // hot reload — all three of which rewrite installed bytes, and those bytes are
  // ours now. See free-model/NOTICE.md.
  //
  // `llm` is a soft dependency on purpose. Their half declares it as its only
  // hard one, and adding it to this plugin's `inject` would mean a host without
  // the model plane loses the other three tabs as well. Nested, the fourth tab
  // goes quiet and the rest of the page keeps answering.
  ctx.inject(['llm'], (lane) => {
    freeModel.apply(lane, { distribution: 'managed' })
  })
}