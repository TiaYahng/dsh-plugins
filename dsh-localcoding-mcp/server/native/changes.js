/**
 * Reversible file changes, reimplemented natively.
 *
 * `lcm_write_file`, `lcm_apply_patch`, `lcm_delete_file` and friends are wrappers
 * over Node's file APIs with no memory of what they replaced — which makes an
 * agent that overwrites the wrong file unrecoverable. This journal is what fixes
 * that: every mutation records the previous bytes first, and `lcm_undo_last_change`
 * puts them back.
 *
 * The journal is deliberately in-memory and small. It is a safety net for the last
 * few edits in one session, not version control; git is what the repo already has
 * for durable history, and pretending otherwise would invite a user to trust it
 * with work it cannot actually recover.
 */

import fs from 'node:fs'
import path from 'node:path'

import { displayPath } from './paths.js'

/** How many mutations stay reversible, and how big each may be. */
const MAX_ENTRIES = 100
const MAX_SNAPSHOT_BYTES = 2_000_000

/** One reversible mutation. */
class Journal {
  constructor () {
    /** @type {Array<object>} */
    this.entries = []
  }

  /**
   * Record a mutation before it happens.
   *
   * @param {object} entry
   * @param {'write'|'patch'|'delete'|'rename'|'move'|'mkdir'|'rmdir'|'copy'} entry.kind
   * @param {string} entry.path absolute path the change targets
   * @param {string} [entry.previousContent] previous text, for write/patch
   * @param {string} [entry.previousPath] previous path, for rename/move
   * @param {boolean} [entry.existed] whether the target existed before
   * @param {boolean} [entry.wasDirectory] whether the target was a directory
   */
  record (entry) {
    this.entries.push({ ...entry, at: Date.now() })
    if (this.entries.length > MAX_ENTRIES) this.entries.shift()
  }

  /** Newest first, without the snapshot payload itself. */
  list (count = 10) {
    return this.entries.slice(-count).reverse().map((entry) => ({
      kind: entry.kind,
      path: entry.path,
      previousPath: entry.previousPath,
      at: new Date(entry.at).toISOString(),
      reversible: entry.reversible !== false,
      note: entry.note
    }))
  }

  /** Remove and return the newest entry, so an undo happens at most once. */
  take () {
    return this.entries.pop()
  }

  get size () {
    return this.entries.length
  }
}

/**
 * Build the journal plus the tools that read and rewind it.
 *
 * @param {{workspaceRoot: string, logger?: object}} deps
 */
export function createChangeTools (deps) {
  const root = deps.workspaceRoot
  const journal = new Journal()

  const tools = [
    {
      name: 'lcm_list_recent_changes',
      description: 'List the file changes this plugin made in this session, newest first, so you can see what to undo. This is the session journal, not git history — use lcm_git_recent_files for commits.',
      parameters: {
        type: 'object',
        properties: { count: { type: 'number', description: 'How many entries to show. Defaults to 10, capped at 100.' } }
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            count: { type: 'number' },
            entries: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  kind: { type: 'string' },
                  path: { type: 'string' },
                  at: { type: 'string' },
                  reversible: { type: 'boolean' }
                },
                additionalProperties: false
              }
            },
            text: { type: 'string' }
          },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: value.text }]
      },
      async execute (args) {
        const count = Math.min(Math.max(Math.floor(Number(args?.count) || 10), 1), MAX_ENTRIES)
        const entries = journal.list(count)
        if (entries.length === 0) {
          return { count: 0, entries: [], text: 'No changes recorded in this session. Only changes made through this plugin are tracked; git operations are not.' }
        }
        const lines = entries.map((entry) => {
          const where = entry.previousPath ? `${entry.previousPath} → ${entry.path}` : entry.path
          return `${entry.at}  ${entry.kind.padEnd(8)} ${where}${entry.reversible ? '' : '  (not reversible)'}`
        })
        return { count: entries.length, entries, text: lines.join('\n') }
      }
    },

    {
      name: 'lcm_undo_last_change',
      description: 'Undo the most recent file change made through this plugin by restoring the content it replaced. Undo one step at a time; each call consumes one journal entry.',
      parameters: {
        type: 'object',
        properties: { steps: { type: 'number', description: 'How many changes to undo, newest first. Defaults to 1.' } }
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            undone: { type: 'number' },
            remaining: { type: 'number' },
            text: { type: 'string' }
          },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: value.text }]
      },
      async execute (args) {
        const steps = Math.min(Math.max(Math.floor(Number(args?.steps) || 1), 1), 20)
        const undone = []
        const failed = []
        for (let index = 0; index < steps; index++) {
          const entry = journal.take()
          if (!entry) break
          try {
            undoEntry(entry)
            undone.push(`${entry.kind} ${displayPath(root, entry.path)}`)
          } catch (error) {
            failed.push(`${entry.kind} ${displayPath(root, entry.path)}: ${error.message}`)
          }
        }
        if (undone.length === 0 && failed.length === 0) {
          return { undone: 0, remaining: journal.size, text: 'Nothing to undo: the change journal is empty.' }
        }
        const parts = []
        if (undone.length > 0) parts.push(`Undid ${undone.length} change${undone.length === 1 ? '' : 's'}:\n${undone.join('\n')}`)
        if (failed.length > 0) parts.push(`Could not undo:\n${failed.join('\n')}`)
        parts.push(`${journal.size} change${journal.size === 1 ? '' : 's'} still recorded.`)
        return { undone: undone.length, remaining: journal.size, text: parts.join('\n\n') }
      }
    }
  ]

  return { journal, tools }
}

/** Put one journal entry back the way it was. Throws when that is impossible. */
function undoEntry (entry) {
  switch (entry.kind) {
    case 'write':
    case 'patch': {
      if (entry.previousContent === undefined) {
        // The file did not exist before this write, so undoing means removing it.
        fs.rmSync(entry.path, { force: true })
        return
      }
      fs.mkdirSync(path.dirname(entry.path), { recursive: true })
      fs.writeFileSync(entry.path, entry.previousContent, 'utf8')
      return
    }
    case 'delete': {
      if (entry.previousContent === undefined) throw new Error('the deleted content was not captured (file was too large)')
      fs.mkdirSync(path.dirname(entry.path), { recursive: true })
      fs.writeFileSync(entry.path, entry.previousContent, 'utf8')
      return
    }
    case 'rename':
    case 'move': {
      fs.mkdirSync(path.dirname(entry.previousPath), { recursive: true })
      fs.renameSync(entry.path, entry.previousPath)
      return
    }
    case 'copy': {
      fs.rmSync(entry.path, { recursive: true, force: true })
      return
    }
    case 'mkdir': {
      fs.rmSync(entry.path, { recursive: true, force: true })
      return
    }
    case 'rmdir': {
      throw new Error('a deleted directory tree cannot be restored from an in-memory journal; use git to recover it')
    }
    default:
      throw new Error(`unknown change kind: ${entry.kind}`)
  }
}

/** Read a file's text for the journal, or undefined when it cannot be captured. */
export function snapshot (absolute) {
  try {
    const stat = fs.statSync(absolute)
    if (!stat.isFile() || stat.size > MAX_SNAPSHOT_BYTES) return undefined
    return fs.readFileSync(absolute, 'utf8')
  } catch {
    return undefined
  }
}

export { Journal, MAX_ENTRIES, MAX_SNAPSHOT_BYTES }