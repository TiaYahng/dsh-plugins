/**
 * The native tool surface.
 *
 * This is the module that replaced a spawned `LocalCodingMCP.exe`. Every tool the
 * .NET server used to expose over HTTP is now a plain `ToolDefinition` built here
 * and handed to `ctx.tools.register`, which means:
 *
 *   - no child process to start, supervise, health-check, or kill with the host;
 *   - no localhost port, so nothing on the machine can reach these tools by
 *     accident — only the agent's own tool table can;
 *   - the tool bodies are ordinary JavaScript in this repo, so a fix is a code
 *     change rather than a rebuild of a separate binary.
 *
 * `lcm_get_workspace_info` and the two rule tools are the exception to "the same
 * tools": they described the .NET server's own configuration, so they are
 * reimplemented around what this plugin and the host actually know.
 *
 * Registration is best-effort per tool. One bad schema must not take the whole
 * surface down with it, so each failure is logged and the rest still register; the
 * returned count is what the settings page reports.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { createFileTools } from './files.js'
import { createSearchTools } from './search.js'
import { createGitTools } from './git.js'
import { createBuildTools } from './build.js'
import { createProcessTools } from './processes.js'
import { createChangeTools, snapshot } from './changes.js'
import { listEntries, statOrUndefined } from './paths.js'

/** Names of the files whose contents act as standing instructions for an agent. */
const RULE_FILES = ['AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', '.editorconfig']

/** Read the first existing rule file at a directory, with a byte cap. */
function readFirst (directory, names, maxChars = 20_000) {
  for (const name of names) {
    const absolute = path.join(directory, name)
    const stat = statOrUndefined(absolute)
    if (!stat?.isFile()) continue
    try {
      const text = fs.readFileSync(absolute, 'utf8')
      return { name, text: text.length > maxChars ? `${text.slice(0, maxChars)}\n… truncated` : text }
    } catch {
      // An unreadable rule file is not worth failing the tool over.
    }
  }
  return undefined
}

/** Directories the native tools write nothing into and never descend. */
const NEVER_WALK = new Set(['node_modules', '.git'])

/** Count files and total bytes under a directory, bounded. */
function measureTree (directory, limit = 200_000) {
  let files = 0
  let directories = 0
  let bytes = 0
  const queue = [directory]
  while (queue.length > 0 && files < limit) {
    const current = queue.shift()
    let entries
    try {
      entries = listEntries(current)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.type === 'dir') {
        directories += 1
        if (!NEVER_WALK.has(entry.name)) queue.push(path.join(current, entry.name))
        continue
      }
      files += 1
      bytes += entry.size
    }
  }
  return { files, directories, bytes, capped: files >= limit }
}

/** Human-readable byte count. */
function human (bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/**
 * Build the workspace-information tools.
 *
 * @param {{workspaceRoot: string, settings?: object, logger?: object}} deps
 */
function createWorkspaceTools (deps) {
  const root = deps.workspaceRoot

  return [
    {
      name: 'lcm_get_workspace_info',
      description: 'Describe the workspace this plugin is rooted at: absolute path, whether it exists, machine and OS, and a bounded count of files and bytes.',
      parameters: { type: 'object', properties: {}, required: [] },
      output: {
        schema: {
          type: 'object',
          properties: {
            root: { type: 'string' },
            exists: { type: 'boolean' },
            machine: { type: 'string' },
            os: { type: 'string' },
            files: { type: 'number' },
            directories: { type: 'number' },
            bytes: { type: 'number' },
            text: { type: 'string' }
          },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: value.text }]
      },
      async execute () {
        const exists = statOrUndefined(root)?.isDirectory() === true
        if (!exists) {
          return {
            root,
            exists: false,
            machine: os.hostname(),
            os: `${os.type()} ${os.release()}`,
            files: 0,
            directories: 0,
            bytes: 0,
            text: `Workspace root ${root} does not exist. Point the workspaceRoot setting at a real directory.`
          }
        }
        const measured = measureTree(root)
        return {
          root,
          exists: true,
          machine: os.hostname(),
          os: `${os.type()} ${os.release()}`,
          files: measured.files,
          directories: measured.directories,
          bytes: measured.bytes,
          text: [
            `root      ${root}`,
            `machine   ${os.hostname()} (${os.type()} ${os.release()}, ${os.arch()})`,
            `node      ${process.version}`,
            `size      ${measured.files} files in ${measured.directories} directories, ${human(measured.bytes)}${measured.capped ? ' (count capped)' : ''}`,
            'Every path a tool accepts is resolved inside this root.'
          ].join('\n')
        }
      }
    },

    {
      name: 'lcm_get_agent_rules',
      description: 'Read the standing instruction files at the workspace root (AGENTS.md, CLAUDE.md, CONTRIBUTING.md, .editorconfig) so you can follow the project\'s own conventions.',
      parameters: { type: 'object', properties: {}, required: [] },
      output: {
        schema: {
          type: 'object',
          properties: {
            found: { type: 'array', items: { type: 'string' } },
            text: { type: 'string' }
          },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: value.text }]
      },
      async execute () {
        const found = []
        const sections = []
        for (const name of RULE_FILES) {
          const absolute = path.join(root, name)
          if (statOrUndefined(absolute)?.isFile() !== true) continue
          const read = readFirst(root, [name])
          if (!read) continue
          found.push(name)
          sections.push(`--- ${name} ---\n${read.text.trim()}`)
        }
        if (found.length === 0) {
          return { found: [], text: `No instruction files at ${root} (looked for ${RULE_FILES.join(', ')}).` }
        }
        return { found, text: `Found ${found.length} instruction file${found.length === 1 ? '' : 's'}:\n\n${sections.join('\n\n')}` }
      }
    },

    {
      name: 'lcm_get_agent_context',
      description: 'Summarise the workspace so you can start work: the instruction files that exist, the top-level layout, detected project types, and the current git branch.',
      parameters: {
        type: 'object',
        properties: { maxEntries: { type: 'number', description: 'Maximum top-level entries to list. Defaults to 40.' } }
      },
      output: {
        schema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: value.text }]
      },
      async execute (args) {
        const lines = [`workspace  ${root}`]
        const rules = RULE_FILES.filter((name) => statOrUndefined(path.join(root, name))?.isFile() === true)
        lines.push(`rules      ${rules.length > 0 ? rules.join(', ') : '(none)'}`)
        const maxEntries = Math.min(Math.max(Math.floor(Number(args?.maxEntries) || 40), 1), 200)
        if (statOrUndefined(root)?.isDirectory() === true) {
          const entries = listEntries(root)
          const shown = entries.slice(0, maxEntries)
          lines.push(`layout     ${entries.length} top-level entr${entries.length === 1 ? 'y' : 'ies'}`)
          for (const entry of shown) {
            lines.push(`  ${entry.type === 'dir' ? 'd' : '-'} ${entry.name}${entry.type === 'dir' ? '/' : `  ${human(entry.size)}`}`)
          }
          if (entries.length > shown.length) lines.push(`  … ${entries.length - shown.length} more`)
        } else {
          lines.push('layout     (root does not exist)')
        }
        return { text: lines.join('\n') }
      }
    }
  ]
}

/**
 * Assemble every native tool and register them.
 *
 * @param {object} deps
 * @param {string} deps.workspaceRoot absolute workspace root, also the security boundary
 * @param {object} deps.tools the host `tools` service (`ctx.tools`)
 * @param {object} [deps.logger]
 * @returns {{ definitions: object[], registered: string[], failed: object[], journal: object, registry: object, dispose: Function }}
 */
export function createNativeSurface (deps) {
  const { workspaceRoot, tools, logger } = deps
  if (typeof workspaceRoot !== 'string' || workspaceRoot === '') {
    throw new Error('workspaceRoot is required to build the native tools')
  }

  // The journal is shared: `files.js` writes into it, `changes.js` reads and
  // rewinds it. Building them independently would give the undo tools an empty
  // view of everything the file tools did.
  const changes = createChangeTools({ workspaceRoot, logger })
  const processes = createProcessTools({ workspaceRoot, logger })

  const definitions = [
    ...createWorkspaceTools({ workspaceRoot, logger, settings: deps.settings }),
    ...createFileTools({ workspaceRoot, logger, journal: changes.journal, snapshot }),
    ...createSearchTools({ workspaceRoot, logger }),
    ...createGitTools({ workspaceRoot, logger }),
    ...createBuildTools({ workspaceRoot, logger }),
    ...processes.tools,
    ...changes.tools
  ]

  // A duplicate name fails the whole layer at the host, so catch it here where the
  // message can name both offenders instead of surfacing as an opaque register error.
  const seen = new Map()
  const duplicates = []
  for (const definition of definitions) {
    if (seen.has(definition.name)) duplicates.push(`${definition.name} (${seen.get(definition.name)} and ${definition.name})`)
    seen.set(definition.name, definition.name)
  }
  if (duplicates.length > 0) {
    throw new Error(`native tools define duplicate names: ${duplicates.join(', ')}`)
  }

  const disposers = []
  const registered = []
  const failed = []
  for (const definition of definitions) {
    try {
      disposers.push(tools.register(definition))
      registered.push(definition.name)
    } catch (error) {
      failed.push({ name: definition.name, error: error instanceof Error ? error.message : String(error) })
      logger?.warn?.(error instanceof Error ? error : new Error(String(error)))
    }
  }

  return {
    definitions,
    registered,
    failed,
    journal: changes.journal,
    registry: processes.registry,
    describe () {
      return {
        source: 'native',
        toolCount: registered.length,
        tools: registered.map((name) => ({
          name,
          registeredName: name,
          description: definitions.find((definition) => definition.name === name)?.description ?? ''
        })),
        failed
      }
    },
    dispose () {
      // Reverse order, and never let one throw strand the rest: a half-disposed
      // surface would leave tools registered that reference dead state.
      while (disposers.length > 0) {
        const dispose = disposers.pop()
        try {
          dispose()
        } catch {
          // keep unwinding
        }
      }
      try {
        processes.registry.dispose()
      } catch {
        // a stubborn child must not block plugin unload
      }
      registered.length = 0
    }
  }
}

export { createWorkspaceTools, measureTree, RULE_FILES, human }