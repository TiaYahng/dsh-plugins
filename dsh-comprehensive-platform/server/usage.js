/**
 * Token accounting folded from stored session logs.
 *
 * Harness keeps token accounting inside each session's durable event log —
 * every `assistant/message` carries the usage its adapter reported — and ships
 * no product surface that adds those records up. This module is that sum: it
 * folds the stored logs into totals and serves one summary document.
 *
 * The fold is a read-only, cache-backed scan: a session is re-read only when
 * its persistence revision moves, so opening the page repeatedly does not
 * re-walk every stored log. Nothing here writes to a session.
 *
 * @module dsh-comprehensive-platform/server/usage
 */
import { fail, sendJson, isTrustedRequest } from './http.js'

/** Loopback route serving one summary document. */
export const SUMMARY_PATH = '/dsh-desktop/usage-stats/summary'

/** Newest-first cap on how many stored sessions one summary folds. */
const MAX_SESSIONS = 400

/** Cap on per-session rows returned to the page. */
const MAX_SESSION_ROWS = 20

/** One additive token bucket. */
function emptyTotals() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    requests: 0,
    turns: 0
  }
}

/** Token counts are provider-reported; anything missing or malformed is 0. */
export function count(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Add one reported usage to a bucket.
 * `totalTokens` is the provider's own total when it reported one and input plus
 * output otherwise; cache reads/writes are kept as their own columns because
 * providers disagree about whether their total already contains them.
 */
function accumulate(target, usage) {
  const input = count(usage.inputTokens)
  const output = count(usage.outputTokens)
  target.inputTokens += input
  target.outputTokens += output
  target.cacheReadTokens += count(usage.cacheReadTokens)
  target.cacheWriteTokens += count(usage.cacheWriteTokens)
  target.reasoningTokens += count(usage.reasoningTokens)
  target.totalTokens += usage.totalTokens === undefined ? input + output : count(usage.totalTokens)
  target.requests += 1
}

/** Local calendar day of one event timestamp, as `YYYY-MM-DD`. */
function dayKey(time) {
  const at = new Date(time)
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return `${at.getFullYear()}-${month}-${day}`
}

/** Fetch-or-create one named bucket. */
function bucket(map, key) {
  const existing = map.get(key)
  if (existing !== undefined) return existing
  const created = emptyTotals()
  map.set(key, created)
  return created
}

/**
 * Fold one session's durable log into token accounting.
 *
 * A route is attributed from the latest `request/header` before each billed
 * message, which is exactly the envelope the call went out under, so a session
 * that switched model mid-conversation splits its usage between those models.
 * @param events - validated contiguous events of one session.
 * @returns the session's totals plus its model and day breakdowns.
 */
export function foldEvents(events) {
  const totals = emptyTotals()
  const models = new Map()
  const days = new Map()
  let provider = 'unknown'
  let model = 'unknown'
  let lastAt = 0
  for (const event of events) {
    if (typeof event?.time === 'number' && event.time > lastAt) lastAt = event.time
    if (event.type === 'request/header') {
      const config = event.data?.header?.config
      if (typeof config?.provider === 'string' && config.provider.length > 0) provider = config.provider
      if (typeof config?.model === 'string' && config.model.length > 0) model = config.model
      continue
    }
    if (event.type === 'turn/end') {
      totals.turns += 1
      continue
    }
    if (event.type !== 'assistant/message') continue
    const usage = event.data?.usage
    if (usage === undefined || usage === null) continue
    accumulate(totals, usage)
    accumulate(bucket(models, `${provider}/${model}`), usage)
    accumulate(bucket(days, dayKey(event.time)), usage)
  }
  return { totals, models, days, lastAt }
}

/** Rows from one breakdown map, heaviest first. */
function ranked(map, decorate) {
  return [...map.entries()]
    .map(([key, value]) => decorate(key, value))
    .sort((a, b) => b.totalTokens - a.totalTokens || a.key.localeCompare(b.key))
}

/**
 * Credit figures derived from the configured conversion. A zero conversion
 * yields zero credits, which the page renders as "not configured" rather than
 * as a free call.
 * @param totals - folded token totals.
 * @param quota - resolved quota configuration.
 * @returns used credits, remaining credits, and the consumed ratio.
 */
export function creditSummary(totals, quota) {
  const used =
    (totals.inputTokens / 1e6) * quota.creditsPerMillionInput +
    (totals.outputTokens / 1e6) * quota.creditsPerMillionOutput
  const quotaCredits = quota.quotaCredits
  return {
    creditsPerMillionInput: quota.creditsPerMillionInput,
    creditsPerMillionOutput: quota.creditsPerMillionOutput,
    quotaCredits,
    usedCredits: Math.round(used * 100) / 100,
    remainingCredits: quotaCredits > 0 ? Math.round((quotaCredits - used) * 100) / 100 : null,
    ratio: quotaCredits > 0 ? used / quotaCredits : null
  }
}

/**
 * Build the whole summary document for one page view.
 * @param persistence - the stored-log reader.
 * @param cache - session-id keyed fold cache owned by the caller.
 * @param quota - resolved quota configuration.
 * @returns the summary, including per-session failures that were skipped.
 */
export async function collectSummary(persistence, cache, quota) {
  const listed = await persistence.list()
  const snapshots = [...listed]
    .sort((a, b) => b.header.createdAt - a.header.createdAt)
    .slice(0, MAX_SESSIONS)
  const totals = emptyTotals()
  const models = new Map()
  const days = new Map()
  const sessions = []
  const failures = []
  for (const snapshot of snapshots) {
    const id = snapshot.header.id
    const key = `${String(snapshot.revision)}:${snapshot.eventCount ?? -1}:${snapshot.sizeBytes ?? -1}`
    let folded = cache.get(id)
    if (folded === undefined || folded.key !== key) {
      let handle
      try {
        handle = await persistence.open(id, 'read')
        const { events } = await handle.read()
        folded = { key, fold: foldEvents(events) }
        cache.set(id, folded)
      } catch (error) {
        failures.push({ id: String(id), message: error instanceof Error ? error.message : String(error) })
        continue
      } finally {
        await handle?.close().catch(() => undefined)
      }
    }
    const { fold } = folded
    totals.inputTokens += fold.totals.inputTokens
    totals.outputTokens += fold.totals.outputTokens
    totals.cacheReadTokens += fold.totals.cacheReadTokens
    totals.cacheWriteTokens += fold.totals.cacheWriteTokens
    totals.reasoningTokens += fold.totals.reasoningTokens
    totals.totalTokens += fold.totals.totalTokens
    totals.requests += fold.totals.requests
    totals.turns += fold.totals.turns
    for (const [route, value] of fold.models) {
      const target = bucket(models, route)
      target.inputTokens += value.inputTokens
      target.outputTokens += value.outputTokens
      target.cacheReadTokens += value.cacheReadTokens
      target.cacheWriteTokens += value.cacheWriteTokens
      target.reasoningTokens += value.reasoningTokens
      target.totalTokens += value.totalTokens
      target.requests += value.requests
    }
    for (const [day, value] of fold.days) {
      const target = bucket(days, day)
      target.inputTokens += value.inputTokens
      target.outputTokens += value.outputTokens
      target.cacheReadTokens += value.cacheReadTokens
      target.cacheWriteTokens += value.cacheWriteTokens
      target.reasoningTokens += value.reasoningTokens
      target.totalTokens += value.totalTokens
      target.requests += value.requests
    }
    sessions.push({
      id: String(id),
      createdAt: snapshot.header.createdAt,
      lastAt: fold.lastAt || snapshot.header.createdAt,
      requests: fold.totals.requests,
      turns: fold.totals.turns,
      totalTokens: fold.totals.totalTokens
    })
  }
  return {
    generatedAt: Date.now(),
    scannedSessions: snapshots.length,
    storedSessions: listed.length,
    totals,
    byModel: ranked(models, (key, value) => {
      const separator = key.indexOf('/')
      return {
        key,
        provider: separator < 0 ? key : key.slice(0, separator),
        model: separator < 0 ? '' : key.slice(separator + 1),
        ...value
      }
    }),
    byDay: ranked(days, (key, value) => ({ day: key, ...value })).sort((a, b) => a.day.localeCompare(b.day)),
    sessions: sessions.sort((a, b) => b.totalTokens - a.totalTokens).slice(0, MAX_SESSION_ROWS),
    quota: creditSummary(totals, quota),
    failures
  }
}

/** Resolve this plugin's quota section from its own resolved Config. */
export function readQuota(config) {
  const source = config !== undefined && config !== null ? config : {}
  return {
    creditsPerMillionInput: count(source.creditsPerMillionInput),
    creditsPerMillionOutput: count(source.creditsPerMillionOutput),
    quotaCredits: count(source.quotaCredits)
  }
}

/**
 * Mount the summary route.
 * @param table - the route table of the mounted web server.
 * @param webCtx - the fiber carrying `logger`.
 * @param persistence - the stored-log reader.
 * @param quota - this plugin's resolved quota configuration.
 * @param cache - session-id keyed fold cache, dropped with the route.
 */
export function registerUsageRoutes(table, webCtx, persistence, quota, cache) {
  table.add(SUMMARY_PATH, async (req, res) => {
    if (req.method !== 'GET' || !isTrustedRequest(req)) {
      sendJson(res, req.method === 'GET' ? 403 : 405, { error: 'Request rejected.' })
      return
    }
    try {
      if (persistence === undefined) {
        sendJson(res, 503, { error: 'Session persistence is not mounted in this profile.' })
        return
      }
      sendJson(res, 200, await collectSummary(persistence, cache, quota))
    } catch (error) {
      fail(webCtx, res, error)
    }
  })
}