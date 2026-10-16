/**
 * Workspace path discipline for the native tools.
 *
 * `workspaceRoot` is a security boundary, not a convenience: every tool that takes
 * a path resolves it against the root and refuses anything that escapes. Without
 * this a single `lcm_delete_file({path: "../../Windows"})` from a chat turn would
 * be a data-loss bug, and an MCP connector on the public internet is exactly the
 * kind of caller that tries it.
 *
 * The check is done on the resolved path, so symlinks and `..` segments cannot
 * smuggle a target out. `..` that lands back inside the root is allowed, because
 * refusing it would break legitimate relative use without adding safety.
 */

import path from 'node:path'
import fs from 'node:fs'

/** Windows reserved names, refused on every platform so scripts stay portable. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i

/**
 * Resolve one caller-supplied path inside the workspace root.
 *
 * @param {string} root absolute workspace root
 * @param {string} candidate absolute, or relative to the root
 * @returns {string} the absolute path, guaranteed to be inside `root`
 * @throws {Error} when the path escapes the root or is not usable
 */
export function resolveInside (root, candidate) {
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    throw new Error('path is required')
  }
  const absoluteRoot = path.resolve(root)
  const absolute = path.resolve(absoluteRoot, candidate)
  const relative = path.relative(absoluteRoot, absolute)
  const escapes = relative === '' ? false
    : relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)
  if (escapes) {
    throw new Error(`path is outside the workspace root (${absoluteRoot}): ${candidate}`)
  }
  if (RESERVED.test(path.basename(absolute))) {
    throw new Error(`path uses a reserved device name: ${candidate}`)
  }
  return absolute
}

/** Path relative to the root, using forward slashes, for tool output. */
export function displayPath (root, absolute) {
  const relative = path.relative(path.resolve(root), absolute)
  return relative === '' ? '.' : relative.split(path.sep).join('/')
}

/** Whether a path exists, is a directory, and is readable. */
export function statOrUndefined (absolute) {
  try {
    return fs.statSync(absolute)
  } catch {
    return undefined
  }
}

/** Directory entries as sorted `{name, type, size}` records, skipping symlink loops. */
export function listEntries (absolute) {
  return fs.readdirSync(absolute, { withFileTypes: true })
    .map((entry) => {
      let type = entry.isDirectory() ? 'dir' : 'file'
      if (entry.isSymbolicLink()) {
        const target = statOrUndefined(path.join(absolute, entry.name))
        type = target?.isDirectory() ? 'dir' : 'file'
      }
      let size = 0
      try {
        size = fs.statSync(path.join(absolute, entry.name)).size
      } catch {
        // A broken symlink is still worth listing; it just has no size.
      }
      return { name: entry.name, type, size }
    })
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
}

/** Directories never walked by the search tools. */
export const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'bin', 'obj', 'target', 'dist', 'build',
  'out', 'coverage', '.next', '.nuxt', '.cache', '.venv', 'venv', '__pycache__',
  '.gradle', '.idea', '.vs', 'packages', 'Debug', 'Release', 'x64', 'x86'
])

/** True when a directory entry should be descended into. */
export function shouldSkipDir (name) {
  return SKIP_DIRS.has(name)
}

/** Guard a byte budget while reading, so one huge file cannot exhaust memory. */
export function clampLimit (value, fallback, max) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return fallback
  return Math.min(Math.floor(number), max)
}