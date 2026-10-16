/**
 * Git tools, reimplemented natively.
 *
 * Git has no library here on purpose: the CLI is what the user's hooks, credential
 * helpers and `includeIf` rules are configured for, and a reimplementation would
 * silently behave differently. Every call therefore goes through `git()` in
 * `proc.js` and reports git's own stderr when it fails.
 *
 * `lcm_git_commit` refuses to commit when nothing is staged, because an empty
 * commit is almost always a caller mistake that is tedious to undo. It does not
 * push — a tool that can publish to a remote is a different risk class.
 */

import path from 'node:path'

import { displayPath, resolveInside } from './paths.js'
import { git, spawnCaptured } from './proc.js'
/** Files whose change is worth reporting before a commit. */
function parseStatus (porcelain) {
  return porcelain
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !line.startsWith('##'))
    .map((line) => ({
      index: line[0],
      worktree: line[1],
      path: line.slice(3).trim()
    }))
}

/**
 * The repository root git would use for a directory, or `undefined` outside a repo.
 *
 * This exists because git walks upward: a workspace nested anywhere under a larger
 * repository is silently operated on as part of that repository. On this machine
 * `C:\Users\HP-XXX\.git` exists, so *every* directory under the user's home is
 * inside a repo — and `git add -A` stages the whole repository, not the current
 * directory. Without this check a commit tool would stage a user's entire home
 * directory from a one-line task.
 */
async function repoRootOf (directory) {
  const result = await spawnCaptured('git', ['rev-parse', '--show-toplevel'], {
    cwd: directory,
    timeoutMs: 20_000,
    maxChars: 8_000
  })
  if (result.code !== 0) return undefined
  const root = result.stdout.trim()
  return root === '' ? undefined : path.resolve(root)
}

/** Whether `ancestor` contains `descendant` (or is it). */
function contains (ancestor, descendant) {
  const relative = path.relative(ancestor, descendant)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/** Describe one porcelain status code in words a model can act on. */
function describeStatus (entry) {
  const { index, worktree } = entry
  if (index === '?' && worktree === '?') return 'untracked'
  if (index === 'A') return 'added'
  if (index === 'M' || worktree === 'M') return 'modified'
  if (index === 'D' || worktree === 'D') return 'deleted'
  if (index === 'R') return 'renamed'
  if (index === 'C') return 'copied'
  if (index === 'U' || (index === 'A' && worktree === 'A')) return 'conflicted'
  return 'changed'
}

/**
 * Build the git tools.
 *
 * @param {{workspaceRoot: string, logger?: object}} deps
 */
export function createGitTools (deps) {
  const root = deps.workspaceRoot
  const inside = (candidate) => resolveInside(root, candidate)

  /** The workspace's own repository root, or a refusal explaining why not. */
  const ownRepo = async () => {
    const repoRoot = await repoRootOf(root)
    if (repoRoot === undefined) {
      throw new Error(`${root} is not inside a git repository`)
    }
    if (path.resolve(repoRoot) !== path.resolve(root)) {
      throw new Error([
        `${root} is not its own repository — git resolves it to ${repoRoot},`,
        `which is ${contains(repoRoot, root) ? 'a parent directory' : 'elsewhere'}.`,
        'A write here would change that repository, not this workspace, so the plugin refuses.',
        'Run `git init` in the workspace to give it its own history.'
      ].join(' '))
    }
    return repoRoot
  }

  return [
    {
      name: 'lcm_git_status',
      description: 'Show the working tree status: current branch, and every changed file with a plain-language change kind.',
      parameters: { type: 'object', properties: {}, required: [] },
      output: {
        schema: {
          type: 'object',
          properties: {
            branch: { type: 'string' },
            clean: { type: 'boolean' },
            changes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  path: { type: 'string' },
                  kind: { type: 'string' },
                  staged: { type: 'boolean' }
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
      async execute () {
        const porcelain = await git(root, ['status', '--porcelain', '--branch'])
        const repoRoot = await repoRootOf(root)
        const branchLine = porcelain.split(/\r?\n/).find((line) => line.startsWith('##')) ?? ''
        const branch = branchLine.replace(/^##\s*/, '').split('...')[0].trim() || '(detached)'
        const changes = parseStatus(porcelain).map((entry) => ({
          path: entry.path,
          kind: describeStatus(entry),
          staged: entry.index !== ' ' && entry.index !== '?'
        }))
        // Reporting the repository root matters here: when it is not the workspace,
        // the paths below belong to a larger repository and the caller needs to
        // know that before it acts on them.
        const foreign = repoRoot !== undefined && path.resolve(repoRoot) !== path.resolve(root)
        const suffix = foreign ? `\nRepository root is ${repoRoot} (not the workspace root).` : ''
        if (changes.length === 0) {
          return { branch, clean: true, changes: [], text: `On ${branch}: working tree clean${suffix}` }
        }
        const lines = changes.map((change) => `${change.staged ? 'staged  ' : 'unstaged'} ${change.kind.padEnd(10)} ${change.path}`)
        return {
          branch,
          clean: false,
          changes,
          text: `On ${branch}: ${changes.length} changed file${changes.length === 1 ? '' : 's'}\n${lines.join('\n')}${suffix}`
        }
      }
    },

    {
      name: 'lcm_git_diff',
      description: 'Show the diff of uncommitted changes. Use cached: true for what is staged, or path to narrow it to one file.',
      parameters: {
        type: 'object',
        properties: {
          cached: { type: 'boolean', description: 'Show staged changes instead of unstaged ones.' },
          path: { type: 'string', description: 'Limit the diff to one path.' },
          maxChars: { type: 'number', description: 'Character cap on the returned diff. Defaults to 40000.' }
        },
        required: []
      },
      output: {
        schema: {
          type: 'object',
          properties: { empty: { type: 'boolean' }, text: { type: 'string' } },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: value.text }]
      },
      async execute (args) {
        const maxChars = Math.min(Math.max(Number(args?.maxChars) || 40_000, 1_000), 400_000)
        const cliArgs = ['diff', '--no-color']
        if (args?.cached === true) cliArgs.push('--cached')
        if (args?.path) cliArgs.push('--', displayPath(root, inside(args.path)))
        const result = await spawnCaptured('git', cliArgs, { cwd: root, timeoutMs: 60_000, maxChars })
        if (result.code !== 0) {
          throw new Error(`git diff failed (exit ${result.code}): ${(result.stderr || result.stdout).trim().slice(0, 800)}`)
        }
        const text = result.stdout.trim()
        if (text === '') {
          return { empty: true, text: args?.cached === true ? 'Nothing staged.' : 'No unstaged changes.' }
        }
        return { empty: false, text }
      }
    },

    {
      name: 'lcm_git_log',
      description: 'Show recent commits, newest first, as hash, date, author and subject.',
      parameters: {
        type: 'object',
        properties: {
          count: { type: 'number', description: 'How many commits to show. Defaults to 15, capped at 200.' },
          path: { type: 'string', description: 'Limit history to one path.' }
        },
        required: []
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            count: { type: 'number' },
            commits: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  hash: { type: 'string' },
                  date: { type: 'string' },
                  author: { type: 'string' },
                  subject: { type: 'string' }
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
        const count = Math.min(Math.max(Math.floor(Number(args?.count) || 15), 1), 200)
        const cliArgs = ['log', `-n${count}`, '--no-color', '--date=short', '--pretty=format:%h%x09%ad%x09%an%x09%s']
        if (args?.path) cliArgs.push('--', displayPath(root, inside(args.path)))
        const output = await git(root, cliArgs)
        const commits = output.split(/\r?\n/).filter(Boolean).map((line) => {
          const [hash, date, author, ...rest] = line.split('\t')
          return { hash, date, author, subject: rest.join('\t') }
        })
        if (commits.length === 0) return { count: 0, commits: [], text: 'No commits yet.' }
        return {
          count: commits.length,
          commits,
          text: commits.map((commit) => `${commit.hash}  ${commit.date}  ${commit.author}  ${commit.subject}`).join('\n')
        }
      }
    },

    {
      name: 'lcm_git_commit',
      description: 'Stage everything and create one commit. Refuses when there is nothing to commit. Does not push.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Commit message.' },
          path: { type: 'string', description: 'Stage only this path instead of everything.' }
        },
        required: ['message']
      },
      output: {
        schema: {
          type: 'object',
          properties: { hash: { type: 'string' }, files: { type: 'number' }, text: { type: 'string' } },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: value.text }]
      },
      async execute (args) {
        const message = String(args?.message ?? '').trim()
        if (message === '') throw new Error('message is required')
        // The workspace must own the repository. `git add -A` stages the whole
        // repository rather than the current directory, so committing inside a
        // larger repo would sweep unrelated files into this commit.
        await ownRepo()
        const addArgs = args?.path ? ['add', '--', displayPath(root, inside(args.path))] : ['add', '-A', '--', '.']
        await git(root, addArgs)
        const staged = await git(root, ['diff', '--cached', '--name-only'])
        const files = staged.split(/\r?\n/).filter(Boolean)
        if (files.length === 0) throw new Error('nothing to commit: no changes are staged')
        await git(root, ['commit', '-m', message])
        const hash = (await git(root, ['rev-parse', '--short', 'HEAD'])).trim()
        return {
          hash,
          files: files.length,
          text: `Committed ${hash}: ${message}\n${files.length} file${files.length === 1 ? '' : 's'} changed:\n${files.join('\n')}`
        }
      }
    },

    {
      name: 'lcm_git_restore_file',
      description: 'Discard uncommitted changes to one file by restoring it from HEAD. This destroys that file\'s local edits.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'File to restore.' } },
        required: ['path']
      },
      output: {
        schema: {
          type: 'object',
          properties: { path: { type: 'string' }, text: { type: 'string' } },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: value.text }]
      },
      async execute (args) {
        await ownRepo()
        const relative = displayPath(root, inside(args?.path))
        await git(root, ['restore', '--', relative])
        return { path: relative, text: `Restored ${relative} from HEAD (local edits to it are gone).` }
      }
    },

    {
      name: 'lcm_git_recent_files',
      description: 'List the files changed by the most recent commits, grouped by commit. This reads git history; for undoing edits made in this session use lcm_list_recent_changes instead.',
      parameters: {
        type: 'object',
        properties: { count: { type: 'number', description: 'How many commits to look back. Defaults to 5.' } },
        required: []
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
        const count = Math.min(Math.max(Math.floor(Number(args?.count) || 5), 1), 50)
        const output = await git(root, ['log', `-n${count}`, '--no-color', '--name-status', '--pretty=format:== %h %ad %s', '--date=short'])
        const text = output.trim()
        return { count, text: text === '' ? 'No commits yet.' : text }
      }
    }
  ]
}

export { parseStatus, describeStatus }