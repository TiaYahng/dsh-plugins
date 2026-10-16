/**
 * File-system tools, reimplemented natively.
 *
 * These replace the `LocalCodingMCP.exe` file tools one for one, so the tool names
 * stay recognisable to anyone who used that server. Every path goes through
 * `resolveInside`, which is the difference between a coding tool and a remote
 * file-deletion primitive: an MCP connector on the public internet can reach
 * these functions, and the workspace root has to hold.
 *
 * Output is deliberately textual and small. The host renders tool results to a
 * model that has to read them, so a directory listing of 40 000 entries is a
 * failure mode, not a feature — every list is capped and says when it was capped.
 */

import fs from 'node:fs'
import path from 'node:path'

import { clampLimit, displayPath, listEntries, resolveInside, statOrUndefined } from './paths.js'

/** Refuse to read a file that would blow the turn's context on its own. */
const DEFAULT_MAX_CHARS = 60_000
/** `read_image` returns bytes; keep one screenshot well under the host's block limit. */
const DEFAULT_MAX_IMAGE_BYTES = 4_000_000

/** Turn a byte count into something a model can reason about. */
function humanSize (bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** One-line-per-entry listing with a leading marker, capped. */
function renderListing (root, absolute, maxEntries) {
  const entries = listEntries(absolute)
  const shown = entries.slice(0, maxEntries)
  const lines = shown.map((entry) => {
    const suffix = entry.type === 'dir' ? '/' : `  ${humanSize(entry.size)}`
    return `${entry.type === 'dir' ? 'd' : '-'} ${entry.name}${suffix}`
  })
  const header = `${displayPath(root, absolute)} — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`
  const capped = entries.length > shown.length ? `\n… ${entries.length - shown.length} more not shown` : ''
  return `${header}\n${lines.join('\n')}${capped}`
}

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonc', '.yml', '.yaml', '.toml', '.ini', '.cfg',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.css', '.scss', '.less',
  '.html', '.htm', '.xml', '.svg', '.vue', '.svelte', '.py', '.rb', '.php', '.java', '.kt',
  '.cs', '.fs', '.vb', '.go', '.rs', '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh',
  '.m', '.mm', '.swift', '.sh', '.bash', '.zsh', '.ps1', '.psm1', '.bat', '.cmd', '.sql',
  '.gradle', '.cmake', '.props', '.targets', '.csproj', '.sln', '.gitignore', '.editorconfig'
])

/** Heuristic: does this look like UTF-8 text a model can usefully read? */
function looksTextual (absolute, sample) {
  if (TEXT_EXTENSIONS.has(path.extname(absolute).toLowerCase())) return true
  // A NUL byte in the first block is the cheapest reliable binary signal.
  return !sample.includes(0)
}

/**
 * Build every file tool.
 *
 * @param {{workspaceRoot: string, logger?: object, journal?: object, snapshot?: Function}} deps
 *   `journal` makes the destructive tools reversible; without it they still work,
 *   they just cannot be undone.
 * @returns {Array<object>} ToolDefinition-ready records, see `native/index.js`
 */
export function createFileTools (deps) {
  const root = deps.workspaceRoot
  const inside = (candidate) => resolveInside(root, candidate)
  /** Remember the bytes a mutation is about to destroy, when a journal exists. */
  const remember = (entry) => deps.journal?.record?.(entry)
  const capture = (absolute) => deps.snapshot?.(absolute)

  return [
    {
      name: 'lcm_read_file',
      description: 'Read a UTF-8 text file from the workspace. Returns the content with 1-based line numbers so you can cite or patch exact lines. Use offset/limit for large files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path, absolute or relative to the workspace root.' },
          offset: { type: 'number', description: '1-based first line to return. Defaults to 1.' },
          limit: { type: 'number', description: 'Maximum number of lines to return. Defaults to all of them.' },
          maxChars: { type: 'number', description: `Character cap for the returned text. Defaults to ${DEFAULT_MAX_CHARS}.` }
        },
        required: ['path']
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            lines: { type: 'number' },
            totalLines: { type: 'number' },
            truncated: { type: 'boolean' },
            text: { type: 'string' }
          },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: value.text }]
      },
      async execute (args) {
        const absolute = inside(args?.path)
        const stat = statOrUndefined(absolute)
        if (!stat) throw new Error(`file does not exist: ${displayPath(root, absolute)}`)
        if (stat.isDirectory()) throw new Error(`path is a directory, not a file: ${displayPath(root, absolute)}`)
        const maxChars = clampLimit(args?.maxChars, DEFAULT_MAX_CHARS, 400_000)
        const buffer = fs.readFileSync(absolute)
        if (!looksTextual(absolute, buffer.subarray(0, 4096))) {
          throw new Error(`file does not look like UTF-8 text (${humanSize(stat.size)}); use lcm_read_image for images`)
        }
        const all = buffer.toString('utf8').split(/\r?\n/)
        const offset = Math.max(1, Math.floor(Number(args?.offset) || 1))
        const limit = args?.limit === undefined ? all.length : Math.max(1, Math.floor(Number(args.limit)))
        let selected = all.slice(offset - 1, offset - 1 + limit)
        let truncated = offset - 1 + selected.length < all.length
        let text = selected.map((line, index) => `${offset + index}\t${line}`).join('\n')
        if (text.length > maxChars) {
          // Cut on a line boundary: half a numbered line reads as corruption.
          text = text.slice(0, maxChars).replace(/\n[^\n]*$/, '')
          truncated = true
        }
        return {
          path: displayPath(root, absolute),
          lines: text === '' ? 0 : text.split('\n').length,
          totalLines: all.length,
          truncated,
          text: truncated ? `${text}\n… output truncated` : text
        }
      }
    },

    {
      name: 'lcm_write_file',
      description: 'Write a UTF-8 text file in the workspace, creating parent directories as needed. Overwrites an existing file completely — use lcm_apply_patch for a targeted change.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path, absolute or relative to the workspace root.' },
          content: { type: 'string', description: 'Full file content.' }
        },
        required: ['path', 'content']
      },
      output: {
        schema: {
          type: 'object',
          properties: { path: { type: 'string' }, bytes: { type: 'number' }, created: { type: 'boolean' } },
          additionalProperties: false
        },
        render: (_args, value) => [{
          type: 'text',
          text: `${value.created ? 'Created' : 'Wrote'} ${value.path} (${value.bytes} bytes)`
        }]
      },
      async execute (args) {
        const absolute = inside(args?.path)
        if (typeof args?.content !== 'string') throw new Error('content must be a string')
        const existed = statOrUndefined(absolute) !== undefined
        const previousContent = existed ? capture(absolute) : undefined
        fs.mkdirSync(path.dirname(absolute), { recursive: true })
        fs.writeFileSync(absolute, args.content, 'utf8')
        remember({ kind: 'write', path: absolute, previousContent, existed })
        return {
          path: displayPath(root, absolute),
          bytes: Buffer.byteLength(args.content, 'utf8'),
          created: !existed
        }
      }
    },

    {
      name: 'lcm_apply_patch',
      description: 'Replace one exact text occurrence in a file. The oldText must appear exactly once unless replaceAll is true, so an ambiguous patch fails instead of editing the wrong place.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path, absolute or relative to the workspace root.' },
          oldText: { type: 'string', description: 'Exact text to replace, including indentation.' },
          newText: { type: 'string', description: 'Replacement text. Use an empty string to delete.' },
          replaceAll: { type: 'boolean', description: 'Replace every occurrence instead of requiring exactly one.' }
        },
        required: ['path', 'oldText', 'newText']
      },
      output: {
        schema: {
          type: 'object',
          properties: { path: { type: 'string' }, replacements: { type: 'number' } },
          additionalProperties: false
        },
        render: (_args, value) => [{
          type: 'text',
          text: `Patched ${value.path} (${value.replacements} replacement${value.replacements === 1 ? '' : 's'})`
        }]
      },
      async execute (args) {
        const absolute = inside(args?.path)
        if (typeof args?.oldText !== 'string' || args.oldText === '') throw new Error('oldText must be a non-empty string')
        if (typeof args?.newText !== 'string') throw new Error('newText must be a string')
        if (!statOrUndefined(absolute)) throw new Error(`file does not exist: ${displayPath(root, absolute)}`)
        const original = fs.readFileSync(absolute, 'utf8')
        const parts = original.split(args.oldText)
        const occurrences = parts.length - 1
        if (occurrences === 0) throw new Error('oldText was not found in the file; read it again and copy the exact text')
        if (occurrences > 1 && args?.replaceAll !== true) {
          throw new Error(`oldText appears ${occurrences} times; include more surrounding text to make it unique, or pass replaceAll: true`)
        }
        const next = args?.replaceAll === true
          ? parts.join(args.newText)
          : original.replace(args.oldText, args.newText)
        fs.writeFileSync(absolute, next, 'utf8')
        remember({ kind: 'patch', path: absolute, previousContent: original, existed: true })
        return { path: displayPath(root, absolute), replacements: args?.replaceAll === true ? occurrences : 1 }
      }
    },

    {
      name: 'lcm_list_files',
      description: 'List the entries of one directory in the workspace, directories first. Non-recursive; call it again on a subdirectory to descend.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path, absolute or relative to the workspace root. Defaults to the root.' },
          maxEntries: { type: 'number', description: 'Maximum entries to return. Defaults to 200.' }
        },
        required: []
      },
      output: {
        schema: {
          type: 'object',
          properties: { path: { type: 'string' }, count: { type: 'number' }, text: { type: 'string' } },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: value.text }]
      },
      async execute (args) {
        const absolute = inside(args?.path ?? '.')
        const stat = statOrUndefined(absolute)
        if (!stat) throw new Error(`directory does not exist: ${displayPath(root, absolute)}`)
        if (!stat.isDirectory()) throw new Error(`path is a file, not a directory: ${displayPath(root, absolute)}`)
        const maxEntries = clampLimit(args?.maxEntries, 200, 5_000)
        const entries = listEntries(absolute)
        return {
          path: displayPath(root, absolute),
          count: entries.length,
          text: renderListing(root, absolute, maxEntries)
        }
      }
    },

    {
      name: 'lcm_create_directory',
      description: 'Create a directory in the workspace, including any missing parents. Succeeds silently if it already exists.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Directory path to create.' } },
        required: ['path']
      },
      output: {
        schema: {
          type: 'object',
          properties: { path: { type: 'string' }, created: { type: 'boolean' } },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: `${value.created ? 'Created' : 'Already existed'}: ${value.path}` }]
      },
      async execute (args) {
        const absolute = inside(args?.path)
        const existed = statOrUndefined(absolute)?.isDirectory() === true
        fs.mkdirSync(absolute, { recursive: true })
        if (!existed) remember({ kind: 'mkdir', path: absolute })
        return { path: displayPath(root, absolute), created: !existed }
      }
    },

    {
      name: 'lcm_delete_file',
      description: 'Delete one file in the workspace. Refuses directories — use lcm_delete_directory for those.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'File path to delete.' } },
        required: ['path']
      },
      output: {
        schema: {
          type: 'object',
          properties: { path: { type: 'string' }, bytes: { type: 'number' } },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: `Deleted ${value.path} (${value.bytes} bytes)` }]
      },
      async execute (args) {
        const absolute = inside(args?.path)
        const stat = statOrUndefined(absolute)
        if (!stat) throw new Error(`file does not exist: ${displayPath(root, absolute)}`)
        if (stat.isDirectory()) throw new Error('path is a directory; use lcm_delete_directory')
        const previousContent = capture(absolute)
        fs.unlinkSync(absolute)
        remember({ kind: 'delete', path: absolute, previousContent, existed: true })
        return { path: displayPath(root, absolute), bytes: stat.size }
      }
    },

    {
      name: 'lcm_delete_directory',
      description: 'Delete a directory in the workspace. Recursive by default, so pass recursive: false when you only expect an empty directory and want the safety check.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to delete.' },
          recursive: { type: 'boolean', description: 'Delete the whole tree. Defaults to true.' }
        },
        required: ['path']
      },
      output: {
        schema: {
          type: 'object',
          properties: { path: { type: 'string' }, entries: { type: 'number' } },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: `Deleted directory ${value.path} (${value.entries} entr${value.entries === 1 ? 'y' : 'ies'})` }]
      },
      async execute (args) {
        const absolute = inside(args?.path)
        const stat = statOrUndefined(absolute)
        if (!stat) throw new Error(`directory does not exist: ${displayPath(root, absolute)}`)
        if (!stat.isDirectory()) throw new Error('path is a file; use lcm_delete_file')
        if (absolute === path.resolve(root)) throw new Error('refusing to delete the workspace root itself')
        const recursive = args?.recursive !== false
        let entries = 0
        if (recursive) {
          const count = (directory) => {
            for (const entry of listEntries(directory)) {
              entries += 1
              if (entry.type === 'dir') count(path.join(directory, entry.name))
            }
          }
          count(absolute)
        } else if (listEntries(absolute).length > 0) {
          throw new Error('directory is not empty; pass recursive: true to delete it and its contents')
        }
        fs.rmSync(absolute, { recursive, force: true })
        // A directory tree has no in-memory snapshot; the journal records it as
        // explicitly non-reversible so an undo reports the truth instead of
        // silently doing nothing.
        remember({ kind: 'rmdir', path: absolute, reversible: false, note: 'directory trees are not captured; use git to recover' })
        return { path: displayPath(root, absolute), entries }
      }
    },

    {
      name: 'lcm_rename_file',
      description: 'Rename a file or directory in place, keeping it in the same parent directory.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Existing path.' },
          newName: { type: 'string', description: 'New name only — not a path.' }
        },
        required: ['path', 'newName']
      },
      output: {
        schema: {
          type: 'object',
          properties: { from: { type: 'string' }, to: { type: 'string' } },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: `Renamed ${value.from} → ${value.to}` }]
      },
      async execute (args) {
        const absolute = inside(args?.path)
        if (!statOrUndefined(absolute)) throw new Error(`path does not exist: ${displayPath(root, absolute)}`)
        const name = String(args?.newName ?? '')
        if (name === '' || name.includes('/') || name.includes('\\')) {
          throw new Error('newName must be a bare name without path separators — use lcm_move_file to relocate')
        }
        const to = inside(path.join(path.dirname(absolute), name))
        fs.renameSync(absolute, to)
        remember({ kind: 'rename', path: to, previousPath: absolute })
        return { from: displayPath(root, absolute), to: displayPath(root, to) }
      }
    },

    {
      name: 'lcm_move_file',
      description: 'Move a file or directory to another location inside the workspace, creating the destination parent directory as needed.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Source path.' },
          destinationPath: { type: 'string', description: 'Destination path.' }
        },
        required: ['path', 'destinationPath']
      },
      output: {
        schema: {
          type: 'object',
          properties: { from: { type: 'string' }, to: { type: 'string' } },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: `Moved ${value.from} → ${value.to}` }]
      },
      async execute (args) {
        const from = inside(args?.path)
        const to = inside(args?.destinationPath)
        if (!statOrUndefined(from)) throw new Error(`source does not exist: ${displayPath(root, from)}`)
        if (from === to) throw new Error('source and destination are the same path')
        fs.mkdirSync(path.dirname(to), { recursive: true })
        fs.renameSync(from, to)
        remember({ kind: 'move', path: to, previousPath: from })
        return { from: displayPath(root, from), to: displayPath(root, to) }
      }
    },

    {
      name: 'lcm_copy_file',
      description: 'Copy a file or directory inside the workspace. A directory is copied recursively.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Source path.' },
          destinationPath: { type: 'string', description: 'Destination path.' }
        },
        required: ['path', 'destinationPath']
      },
      output: {
        schema: {
          type: 'object',
          properties: { from: { type: 'string' }, to: { type: 'string' }, bytes: { type: 'number' } },
          additionalProperties: false
        },
        render: (_args, value) => [{
          type: 'text',
          text: `Copied ${value.from} → ${value.to} (${humanSize(value.bytes)})`
        }]
      },
      async execute (args) {
        const from = inside(args?.path)
        const to = inside(args?.destinationPath)
        const stat = statOrUndefined(from)
        if (!stat) throw new Error(`source does not exist: ${displayPath(root, from)}`)
        fs.mkdirSync(path.dirname(to), { recursive: true })
        fs.cpSync(from, to, { recursive: stat.isDirectory() })
        const size = stat.isDirectory()
          ? (function walk (directory) {
              let total = 0
              for (const entry of listEntries(directory)) {
                total += entry.type === 'dir' ? walk(path.join(directory, entry.name)) : entry.size
              }
              return total
            })(to)
          : stat.size
        remember({ kind: 'copy', path: to })
        return { from: displayPath(root, from), to: displayPath(root, to), bytes: size }
      }
    },

    {
      name: 'lcm_read_image',
      description: 'Read an image file from the workspace and return it as an image the model can look at. Supports PNG, JPEG, WebP and GIF.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Image path, absolute or relative to the workspace root.' },
          maxBytes: { type: 'number', description: `Refuse images larger than this. Defaults to ${DEFAULT_MAX_IMAGE_BYTES}.` }
        },
        required: ['path']
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            mediaType: { type: 'string' },
            bytes: { type: 'number' },
            base64: { type: 'string' }
          },
          additionalProperties: false
        },
        render: (_args, value) => [
          { type: 'text', text: `${value.path} (${value.mediaType}, ${humanSize(value.bytes)})` },
          { type: 'image', source: { type: 'base64', mediaType: value.mediaType, data: value.base64 } }
        ]
      },
      async execute (args) {
        const absolute = inside(args?.path)
        const stat = statOrUndefined(absolute)
        if (!stat || stat.isDirectory()) throw new Error(`image does not exist: ${displayPath(root, absolute)}`)
        const maxBytes = clampLimit(args?.maxBytes, DEFAULT_MAX_IMAGE_BYTES, 20_000_000)
        if (stat.size > maxBytes) {
          throw new Error(`image is ${humanSize(stat.size)}, over the ${humanSize(maxBytes)} limit; pass a larger maxBytes if you really need it`)
        }
        const extension = path.extname(absolute).toLowerCase()
        const mediaType = extension === '.png' ? 'image/png'
          : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg'
            : extension === '.webp' ? 'image/webp'
              : extension === '.gif' ? 'image/gif'
                : undefined
        if (!mediaType) throw new Error(`unsupported image type "${extension || '(none)'}"; expected .png, .jpg, .jpeg, .webp or .gif`)
        return {
          path: displayPath(root, absolute),
          mediaType,
          bytes: stat.size,
          base64: fs.readFileSync(absolute).toString('base64')
        }
      }
    }
  ]
}

export { looksTextual, humanSize, DEFAULT_MAX_CHARS, DEFAULT_MAX_IMAGE_BYTES }