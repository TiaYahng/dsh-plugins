/**
 * Workspace-root confinement.
 *
 * The client sends a workspace root as a path string, so every request that
 * touches the filesystem has to re-derive it from the registry instead of
 * trusting the wire. Roots are matched case-folded because Windows paths reach
 * us with different drive-case depending on the caller.
 *
 * @module dsh-desktop-workbench/server/workspace
 */
import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

/**
 * The registry's workspace roots, keyed by a case-folded absolute path.
 * @param registry - the host workspace registry.
 * @returns a case-folded lookup of canonical roots.
 */
export function workspaceRoots(registry) {
  const roots = new Map()
  for (const workspace of registry.list()) {
    const path = workspace?.path
    if (typeof path !== 'string' || path.length === 0 || !isAbsolute(path)) continue
    const resolved = resolve(path)
    roots.set(resolved.toLowerCase(), resolved)
  }
  return roots
}

/**
 * Confine a client-supplied root to the registry's own workspace roots.
 * @returns the canonical resolved root, or null when the path is not one.
 */
export function confineRoot(registry, raw) {
  if (typeof raw !== 'string' || raw.length === 0 || !isAbsolute(raw)) return null
  return workspaceRoots(registry).get(resolve(raw).toLowerCase()) ?? null
}

/** Read a UTF-8 file, mapping a miss to `null` instead of throwing. */
export async function readTextFile(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return null
    throw error
  }
}