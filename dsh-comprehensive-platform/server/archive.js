/**
 * The archive half: the way back out of an archived session, plus the
 * workspace list the memory half's picker needs.
 *
 * Upstream archives a session (workspace context menu → 归档会话) durably in
 * the workspace registry's global archive set, but ships no way back: the
 * registry has `archiveSession` and `forgetSession` (permanent delete) and
 * nothing between, and the desktop companion merely filters archived ids out
 * of its lists. This module adds the missing direction — restore.
 *
 * @module dsh-comprehensive-platform/server/archive
 */
import { fail, isTrustedRequest, readJson, sendJson } from './http.js'

/** Loopback routes serving the archive tab. */
export const LIST_PATH = '/dsh-desktop/shell/archive.list'
export const WORKSPACES_PATH = '/dsh-desktop/shell/workspaces'
export const RESTORE_PATH = '/dsh-desktop/shell/archive.restore'

/**
 * Restore one archived session: remove its id from the registry-global
 * archive set. Mirrors the registry's own `archiveSession` shape — an
 * enqueued operation that rewrites state — so persistence semantics stay
 * identical to the direction upstream ships.
 */
async function restoreSession(registry, sessionId) {
  await registry.enqueueOperation(async () => {
    const state = registry.requireState()
    if (!state.archivedSessionIds.includes(sessionId)) return
    await registry.setState({
      ...state,
      archivedSessionIds: state.archivedSessionIds.filter((id) => id !== sessionId)
    })
  })
  return [...registry.archivedSessionIds]
}

/**
 * One row per archived session, newest update first. Titles and timestamps
 * come from the stored session headers (the registry keeps a live+stored
 * index); an unreadable header degrades to a null title rather than dropping
 * the row — the session exists, the page must list it.
 */
export async function collectArchive(registry) {
  const archivedSessionIds = [...registry.archivedSessionIds]
  const byId = new Map()
  try {
    for (const header of await registry.listStoredHeaders()) {
      byId.set(String(header?.id), header)
    }
  } catch {
    // A listing failure only loses titles; the archive set itself is authoritative.
  }
  const sessions = archivedSessionIds
    .map((sessionId) => {
      const header = byId.get(String(sessionId))
      return {
        sessionId,
        title: typeof header?.title === 'string' && header.title.length > 0 ? header.title : null,
        createdAt: typeof header?.createdAt === 'number' ? header.createdAt : null,
        updatedAt: typeof header?.updatedAt === 'number' ? header.updatedAt : (typeof header?.createdAt === 'number' ? header.createdAt : null)
      }
    })
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  return { archivedSessionIds, sessions, generatedAt: Date.now() }
}

/** The registered workspaces, as the client picker needs them. */
export function collectWorkspaces(registry) {
  return {
    workspaces: registry.list().map((workspace) => ({
      workspaceId: workspace.id,
      path: workspace.path,
      title: typeof workspace.title === 'string' && workspace.title.length > 0 ? workspace.title : workspace.path
    }))
  }
}

/**
 * Mount the archive listing, the workspace list, and the restore action.
 * @param table - the route table of the mounted web server.
 * @param webCtx - the fiber carrying `logger`.
 * @param registry - the host workspace registry.
 */
export function registerArchiveRoutes(table, webCtx, registry) {
  table.get(LIST_PATH, () => collectArchive(registry))
  table.get(WORKSPACES_PATH, () => collectWorkspaces(registry))
  table.add(RESTORE_PATH, async (req, res) => {
    if (!isTrustedRequest(req)) return sendJson(res, 403, { error: 'Request rejected.' })
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' })
    const body = await readJson(req)
    if (typeof body?.sessionId !== 'string' || body.sessionId.length === 0) {
      return sendJson(res, 400, { error: 'sessionId is required.' })
    }
    try {
      const archivedSessionIds = await restoreSession(registry, body.sessionId)
      sendJson(res, 200, { ok: true, archivedSessionIds })
    } catch (error) {
      fail(webCtx, res, error)
    }
  })
}