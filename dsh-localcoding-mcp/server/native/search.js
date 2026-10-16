/**
 * Search and code-intelligence tools, reimplemented natively.
 *
 * `lcm_search_code` walks the tree itself rather than shelling out to `rg`, because
 * the workspace may not have ripgrep on PATH and a silent `command not found`
 * would read to the model as "no matches" — the worst possible failure for a
 * search tool. The walk is bounded in every direction (files visited, bytes per
 * file, matches returned) so a stray `node_modules` or a 40 MB bundle cannot hang
 * a turn.
 *
 * `lcm_find_definitions` is a regex over declaration syntax for the handful of
 * languages this workspace actually contains. Its `language` parameter changes the
 * pattern; it does not attempt to parse, and the description says so, because a
 * tool that overstates its confidence is worse than one that admits a heuristic.
 */

import fs from 'node:fs'
import path from 'node:path'

import { clampLimit, displayPath, listEntries, resolveInside, shouldSkipDir, statOrUndefined } from './paths.js'
import { looksTextual } from './files.js'

/** Hard ceilings: a search that cannot finish is indistinguishable from a hang. */
const MAX_FILES_SCANNED = 20_000
const MAX_FILE_BYTES = 2_000_000
const MAX_MATCHES = 500

/** Languages whose declaration syntax `lcm_find_definitions` knows. */
const DECLARATION_PATTERNS = {
  javascript: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)|^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/,
  typescript: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/,
  python: /^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/,
  csharp: /^\s*(?:\[[^\]]*\]\s*)*(?:public|private|protected|internal|static|sealed|abstract|partial|async|override|virtual|readonly|\s)*\b(?:class|interface|struct|enum|record)\s+([A-Za-z_]\w*)|^\s*(?:public|private|protected|internal|static|async|override|virtual|\s)+[\w<>[\],.?]+\s+([A-Za-z_]\w*)\s*\(/,
  go: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)|^\s*type\s+([A-Za-z_]\w*)/,
  rust: /^\s*(?:pub\s+)?(?:async\s+)?(?:fn|struct|enum|trait|impl)\s+([A-Za-z_]\w*)/,
  java: /^\s*(?:public|private|protected|static|final|abstract|\s)*\b(?:class|interface|enum|record)\s+([A-Za-z_]\w*)|^\s*(?:public|private|protected|static|final|abstract|synchronized|\s)+[\w<>[\],.?]+\s+([A-Za-z_]\w*)\s*\(/,
  cpp: /^\s*(?:template\s*<[^>]*>\s*)?(?:class|struct|enum)\s+([A-Za-z_]\w*)/
}

/** Sorted shallow-to-deep list of files under a directory, honouring the skip set. */
function walkFiles (root, start, { extensions, limit }) {
  const found = []
  const queue = [start]
  let visited = 0
  while (queue.length > 0 && found.length < limit) {
    const directory = queue.shift()
    let entries
    try {
      entries = listEntries(directory)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (found.length >= limit) break
      if (visited++ > MAX_FILES_SCANNED) return { files: found, capped: true }
      const absolute = path.join(directory, entry.name)
      if (entry.type === 'dir') {
        if (!shouldSkipDir(entry.name)) queue.push(absolute)
        continue
      }
      if (extensions && !extensions.has(path.extname(entry.name).toLowerCase())) continue
      found.push(absolute)
    }
  }
  return { files: found, capped: visited > MAX_FILES_SCANNED }
}

/** Build one `file:line: text` record, skipping oversized and binary files. */
function readTextFile (absolute) {
  const stat = statOrUndefined(absolute)
  if (!stat || stat.size === 0 || stat.size > MAX_FILE_BYTES) return undefined
  let buffer
  try {
    buffer = fs.readFileSync(absolute)
  } catch {
    return undefined
  }
  if (!looksTextual(absolute, buffer.subarray(0, 4096))) return undefined
  return buffer.toString('utf8')
}

/**
 * Build the search tools.
 *
 * @param {{workspaceRoot: string, logger?: object}} deps
 */
export function createSearchTools (deps) {
  const root = deps.workspaceRoot
  const inside = (candidate) => resolveInside(root, candidate)

  /** Shared body of every searching tool: compile, walk, match, render. */
  const search = (start, pattern, options = {}) => {
    const expression = options.literal
      ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options.caseSensitive ? 'g' : 'gi')
      : new RegExp(pattern, options.caseSensitive ? 'g' : 'gi')
    const maxResults = clampLimit(options.maxResults, 100, MAX_MATCHES)
    const extensions = options.extensions
    const { files, capped } = walkFiles(root, start, { extensions, limit: MAX_FILES_SCANNED })
    const matches = []
    const byFile = new Map()
    for (const absolute of files) {
      if (matches.length >= maxResults) break
      const text = readTextFile(absolute)
      if (text === undefined) continue
      const lines = text.split(/\r?\n/)
      for (let index = 0; index < lines.length; index++) {
        if (matches.length >= maxResults) break
        const line = lines[index]
        expression.lastIndex = 0
        if (!expression.test(line)) continue
        const relative = displayPath(root, absolute)
        matches.push({ file: relative, line: index + 1, text: line.trim().slice(0, 300) })
        byFile.set(relative, (byFile.get(relative) ?? 0) + 1)
      }
    }
    return { matches, byFile, filesScanned: files.length, capped }
  }

  return [
    {
      name: 'lcm_search_code',
      description: 'Search file contents in the workspace with a regular expression and return matching lines as path:line:text. Skips dependency and build directories, and reports how many files it actually scanned.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Regular expression to search for. Use plain words for a literal search.' },
          path: { type: 'string', description: 'Directory to search in, relative to the workspace root. Defaults to the root.' },
          literal: { type: 'boolean', description: 'Treat the query as plain text instead of a regular expression.' },
          caseSensitive: { type: 'boolean', description: 'Match case-sensitively. Defaults to false.' },
          extensions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Only search files with these extensions, e.g. [".ts", ".tsx"]. Defaults to every text file.'
          },
          maxResults: { type: 'number', description: 'Maximum matching lines. Defaults to 100, capped at 500.' }
        },
        required: ['query']
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            count: { type: 'number' },
            filesScanned: { type: 'number' },
            filesMatched: { type: 'number' },
            text: { type: 'string' }
          },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: value.text }]
      },
      async execute (args) {
        const start = inside(args?.path ?? '.')
        if (typeof args?.query !== 'string' || args.query === '') throw new Error('query is required')
        if (!statOrUndefined(start)) throw new Error(`search path does not exist: ${displayPath(root, start)}`)
        const rawExtensions = Array.isArray(args?.extensions) ? args.extensions : undefined
        const extensions = rawExtensions && rawExtensions.length > 0
          ? new Set(rawExtensions.map((entry) => {
            const text = String(entry)
            return text.startsWith('.') ? text.toLowerCase() : `.${text.toLowerCase()}`
          }))
          : undefined
        let result
        try {
          result = search(start, args.query, {
            literal: args?.literal === true,
            caseSensitive: args?.caseSensitive === true,
            maxResults: args?.maxResults,
            extensions
          })
        } catch (error) {
          if (error instanceof SyntaxError) throw new Error(`invalid regular expression: ${error.message}`)
          throw error
        }
        const lines = result.matches.map((match) => `${match.file}:${match.line}: ${match.text}`)
        const summary = `${result.matches.length} match${result.matches.length === 1 ? '' : 'es'} in ${result.byFile.size} file${result.byFile.size === 1 ? '' : 's'} (scanned ${result.filesScanned})`
        return {
          count: result.matches.length,
          filesScanned: result.filesScanned,
          filesMatched: result.byFile.size,
          text: lines.length === 0
            ? `No matches for ${JSON.stringify(args.query)}. ${summary}`
            : `${summary}\n${lines.join('\n')}`
        }
      }
    },

    {
      name: 'lcm_find_definitions',
      description: 'Find where a symbol is declared, using per-language declaration patterns (function, class, interface, type, enum, struct, def, fn). This is a pattern match over declaration syntax, not a type-aware lookup — a symbol used only through indirection will not appear.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Symbol name, matched as a whole word.' },
          path: { type: 'string', description: 'Directory to search in, relative to the workspace root. Defaults to the root.' },
          language: {
            type: 'string',
            enum: Object.keys(DECLARATION_PATTERNS),
            description: 'Restrict to one language\'s declaration syntax. Defaults to trying all of them.'
          },
          maxResults: { type: 'number', description: 'Maximum declarations to return. Defaults to 50.' }
        },
        required: ['symbol']
      },
      output: {
        schema: {
          type: 'object',
          properties: { count: { type: 'number' }, text: { type: 'string' } },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: value.text }]
      },
      async execute (args) {
        const start = inside(args?.path ?? '.')
        const symbol = String(args?.symbol ?? '').trim()
        if (symbol === '') throw new Error('symbol is required')
        if (!statOrUndefined(start)) throw new Error(`search path does not exist: ${displayPath(root, start)}`)
        const maxResults = clampLimit(args?.maxResults, 50, 200)
        const languages = args?.language
          ? [String(args.language)]
          : Object.keys(DECLARATION_PATTERNS)
        for (const language of languages) {
          if (!DECLARATION_PATTERNS[language]) {
            throw new Error(`unknown language "${language}"; expected one of ${Object.keys(DECLARATION_PATTERNS).join(', ')}`)
          }
        }
        const word = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
        const { files } = walkFiles(root, start, { extensions: undefined, limit: MAX_FILES_SCANNED })
        const found = []
        for (const absolute of files) {
          if (found.length >= maxResults) break
          const text = readTextFile(absolute)
          if (text === undefined) continue
          const lines = text.split(/\r?\n/)
          for (let index = 0; index < lines.length; index++) {
            if (found.length >= maxResults) break
            const line = lines[index]
            if (!word.test(line)) continue
            for (const language of languages) {
              const match = DECLARATION_PATTERNS[language].exec(line)
              if (!match) continue
              const declared = match[1] ?? match[2]
              if (declared !== symbol) continue
              found.push({ file: displayPath(root, absolute), line: index + 1, language, text: line.trim().slice(0, 300) })
              break
            }
          }
        }
        if (found.length === 0) {
          return { count: 0, text: `No declaration of "${symbol}" found. This is a declaration-pattern search, so a symbol reached only through indirection would not appear.` }
        }
        return {
          count: found.length,
          text: `${found.length} declaration${found.length === 1 ? '' : 's'} of ${symbol}:\n${found.map((entry) => `${entry.file}:${entry.line}: [${entry.language}] ${entry.text}`).join('\n')}`
        }
      }
    }
  ]
}

export { DECLARATION_PATTERNS, walkFiles, readTextFile, MAX_MATCHES }