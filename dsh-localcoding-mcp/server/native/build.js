/**
 * Build, test and command tools, reimplemented natively.
 *
 * `lcm_detect_build_tools` exists because the alternative is the model guessing:
 * a workspace may hold .NET, Node, Python and Qt projects side by side, and the
 * command that builds one is wrong for the others. Detection reads the manifest
 * files that actually decide this (`*.csproj`, `package.json`, `pyproject.toml`,
 * `CMakeLists.txt`, `*.pro`) and reports what it found plus whether the tool it
 * would invoke is on PATH.
 *
 * `lcm_run_native_command` runs an arbitrary executable. It is the one tool whose
 * blast radius is the whole machine, so its description states that plainly rather
 * than pretending to be sandboxed — the workspace root does not confine a command's
 * effects, and claiming otherwise would be the dangerous kind of lie.
 */

import fs from 'node:fs'
import path from 'node:path'

import { clampLimit, displayPath, listEntries, resolveInside, shouldSkipDir, statOrUndefined } from './paths.js'
import { commandExists, spawnCaptured } from './proc.js'

/** Build systems this workspace's projects actually use. */
const PROJECT_MARKERS = [
  { file: 'package.json', language: 'node', build: 'npm run build', test: 'npm test', install: 'npm install' },
  { file: 'pnpm-workspace.yaml', language: 'node', build: 'pnpm run build', test: 'pnpm test', install: 'pnpm install' },
  { file: 'yarn.lock', language: 'node', build: 'yarn build', test: 'yarn test', install: 'yarn install' },
  { file: 'pyproject.toml', language: 'python', build: 'python -m build', test: 'pytest', install: 'pip install -e .' },
  { file: 'requirements.txt', language: 'python', build: '', test: 'pytest', install: 'pip install -r requirements.txt' },
  { file: 'setup.py', language: 'python', build: 'python setup.py build', test: 'pytest', install: 'pip install -e .' },
  { file: 'CMakeLists.txt', language: 'cmake', build: 'cmake --build build', test: 'ctest --test-dir build', install: 'cmake -S . -B build' },
  { file: 'Cargo.toml', language: 'rust', build: 'cargo build', test: 'cargo test', install: '' },
  { file: 'go.mod', language: 'go', build: 'go build ./...', test: 'go test ./...', install: 'go mod download' },
  { file: 'pom.xml', language: 'java', build: 'mvn -q package', test: 'mvn -q test', install: '' },
  { file: 'build.gradle', language: 'java', build: 'gradle build', test: 'gradle test', install: '' },
  { file: 'build.gradle.kts', language: 'java', build: 'gradle build', test: 'gradle test', install: '' },
  { file: 'Makefile', language: 'make', build: 'make', test: 'make test', install: '' }
]

/** Languages a `compile_project` call may name, mapped to their single-file compiler. */
const COMPILERS = {
  csharp: { command: 'dotnet', args: (file) => ['build', file] },
  c: { command: 'gcc', args: (file) => ['-o', 'a.exe', file] },
  cpp: { command: 'g++', args: (file) => ['-o', 'a.exe', file] },
  rust: { command: 'rustc', args: (file) => [file] },
  go: { command: 'go', args: (file) => ['build', file] },
  java: { command: 'javac', args: (file) => [file] },
  typescript: { command: 'tsc', args: (file) => ['--noEmit', file] },
  python: { command: 'python', args: (file) => ['-m', 'py_compile', file] }
}

/** Find project markers under a directory, shallow-first and depth-bounded. */
function detectProjects (start, maxDepth = 3, limit = 50) {
  const found = []
  const queue = [{ directory: start, depth: 0 }]
  while (queue.length > 0 && found.length < limit) {
    const { directory, depth } = queue.shift()
    let entries
    try {
      entries = listEntries(directory)
    } catch {
      continue
    }
    const byName = new Map(entries.map((entry) => [entry.name, entry]))
    for (const marker of PROJECT_MARKERS) {
      if (!byName.has(marker.file)) continue
      found.push({ directory, marker, depth })
    }
    // Qt projects declare themselves with a .pro file rather than a fixed name.
    const proFile = entries.find((entry) => entry.type === 'file' && entry.name.endsWith('.pro'))
    if (proFile) found.push({ directory, marker: { file: proFile.name, language: 'qt', build: 'qmake && make', test: '', install: 'qmake' }, depth })
    if (depth >= maxDepth) continue
    for (const entry of entries) {
      if (entry.type !== 'dir' || shouldSkipDir(entry.name) || entry.name.startsWith('.')) continue
      queue.push({ directory: path.join(directory, entry.name), depth: depth + 1 })
    }
  }
  return found
}

/**
 * Build the command, build and test tools.
 *
 * @param {{workspaceRoot: string, logger?: object}} deps
 */
export function createBuildTools (deps) {
  const root = deps.workspaceRoot
  const inside = (candidate) => resolveInside(root, candidate)

  return [
    {
      name: 'lcm_detect_build_tools',
      description: 'List the build tools available on this machine (dotnet, node, npm, python, cargo, go, cmake, g++, qmake and friends) with their versions.',
      parameters: { type: 'object', properties: {}, required: [] },
      output: {
        schema: {
          type: 'object',
          properties: {
            available: { type: 'array', items: { type: 'string' } },
            missing: { type: 'array', items: { type: 'string' } },
            text: { type: 'string' }
          },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: value.text }]
      },
      async execute () {
        const candidates = ['dotnet', 'node', 'npm', 'pnpm', 'yarn', 'python', 'py', 'pip', 'cargo', 'rustc', 'go', 'cmake', 'make', 'gcc', 'g++', 'clang', 'javac', 'java', 'mvn', 'gradle', 'qmake', 'git', 'rg']
        const available = []
        const missing = []
        const versions = []
        for (const command of candidates) {
          const versionArg = command === 'java' || command === 'javac' ? '-version'
            : command === 'go' ? 'version'
              : '--version'
          const exists = await commandExists(command)
          if (!exists) { missing.push(command); continue }
          available.push(command)
          const version = await spawnCaptured(command, [versionArg], { timeoutMs: 8_000, maxChars: 2_000 })
          const first = `${version.stdout}\n${version.stderr}`.split(/\r?\n/).find((line) => line.trim() !== '') ?? ''
          versions.push(`${command.padEnd(8)} ${first.trim().slice(0, 80)}`)
        }
        return {
          available,
          missing,
          text: `${available.length} of ${candidates.length} tools found:\n${versions.join('\n')}${missing.length ? `\n\nnot found: ${missing.join(', ')}` : ''}`
        }
      }
    },

    {
      name: 'lcm_detect_project',
      description: 'Detect the project type of a directory by reading its manifest files, and report the build, test and install commands that fit it.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory to inspect. Defaults to the workspace root.' },
          maxDepth: { type: 'number', description: 'How deep to look for projects. Defaults to 3.' }
        },
        required: []
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            count: { type: 'number' },
            projects: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  path: { type: 'string' },
                  language: { type: 'string' },
                  marker: { type: 'string' }
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
        const start = inside(args?.path ?? '.')
        if (statOrUndefined(start)?.isDirectory() !== true) {
          throw new Error(`not a directory: ${displayPath(root, start)}`)
        }
        const maxDepth = clampLimit(args?.maxDepth, 3, 10)
        const found = detectProjects(start, maxDepth)
        if (found.length === 0) {
          return { count: 0, projects: [], text: `No recognised project markers under ${displayPath(root, start)} (looked ${maxDepth} level${maxDepth === 1 ? '' : 's'} deep).` }
        }
        const projects = found.map((entry) => ({
          path: displayPath(root, entry.directory),
          language: entry.marker.language,
          marker: entry.marker.file
        }))
        const lines = found.map((entry) => {
          const where = displayPath(root, entry.directory)
          const parts = [`${where}  [${entry.marker.language}] via ${entry.marker.file}`]
          if (entry.marker.install) parts.push(`    install: ${entry.marker.install}`)
          if (entry.marker.build) parts.push(`    build:   ${entry.marker.build}`)
          if (entry.marker.test) parts.push(`    test:    ${entry.marker.test}`)
          return parts.join('\n')
        })
        return { count: found.length, projects, text: lines.join('\n') }
      }
    },

    {
      name: 'lcm_build_project',
      description: 'Build a project by running the command its own manifest implies. Detects the project type first, then runs the matching build command in that directory.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project directory. Defaults to the workspace root.' },
          language: { type: 'string', description: 'Force a project type instead of detecting it (node, python, cmake, rust, go, java, make, qt).' },
          timeoutSeconds: { type: 'number', description: 'Wall-clock budget. Defaults to 600, capped at 3600.' }
        },
        required: []
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            command: { type: 'string' },
            exitCode: { type: 'number' },
            durationMs: { type: 'number' },
            timedOut: { type: 'boolean' },
            output: { type: 'string' }
          },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: value.output }]
      },
      async execute (args, exec) {
        const start = inside(args?.path ?? '.')
        if (statOrUndefined(start)?.isDirectory() !== true) throw new Error(`not a directory: ${displayPath(root, start)}`)
        const detected = detectProjects(start, 0, 1)
        const wanted = typeof args?.language === 'string' && args.language !== ''
          ? detected.find((entry) => entry.marker.language === args.language) ?? detected[0]
          : detected[0]
        if (!wanted) throw new Error(`no recognised project marker in ${displayPath(root, start)}; pass language explicitly to force one`)
        const command = wanted.marker.build
        if (!command) throw new Error(`the ${wanted.marker.language} project at ${displayPath(root, wanted.directory)} declares no build command`)
        const timeoutMs = Math.min(Math.max(Number(args?.timeoutSeconds ?? 600), 5), 3600) * 1000
        const [executable, ...rest] = command.split(' ')
        const result = await spawnCaptured(executable, rest, {
          cwd: wanted.directory,
          timeoutMs,
          maxChars: 120_000,
          signal: exec?.signal
        })
        const header = `${command}  →  exit ${result.code}${result.timedOut ? ' (timed out)' : ''} in ${(result.durationMs / 1000).toFixed(1)}s`
        return {
          ok: result.code === 0 && !result.timedOut,
          command,
          exitCode: result.code,
          durationMs: result.durationMs,
          timedOut: result.timedOut,
          output: `${header}\n\n${(result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : '')).slice(0, 100_000) || '(no output)'}`
        }
      }
    },

    {
      name: 'lcm_clean_project',
      description: 'Remove the build output of a project (bin/obj, dist, build, target, __pycache__ and similar), leaving sources untouched.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project directory. Defaults to the workspace root.' },
          language: { type: 'string', description: 'Project type, used to pick which artifacts to remove.' }
        },
        required: []
      },
      output: {
        schema: {
          type: 'object',
          properties: { removed: { type: 'array', items: { type: 'string' } }, bytes: { type: 'number' }, text: { type: 'string' } },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: value.text }]
      },
      async execute (args) {
        const start = inside(args?.path ?? '.')
        if (start === path.resolve(root)) {
          throw new Error('refusing to clean the workspace root itself; point at one project directory')
        }
        const artifacts = new Set(['bin', 'obj', 'dist', 'build', 'out', 'target', '__pycache__', '.pytest_cache', 'node_modules/.cache'])
        const removed = []
        let bytes = 0
        const measure = (directory) => {
          let total = 0
          for (const entry of listEntries(directory)) {
            total += entry.type === 'dir' ? measure(path.join(directory, entry.name)) : entry.size
          }
          return total
        }
        const visit = (directory, depth) => {
          if (depth > 4) return
          let entries
          try {
            entries = listEntries(directory)
          } catch {
            return
          }
          for (const entry of entries) {
            if (entry.type !== 'dir') continue
            const absolute = path.join(directory, entry.name)
            if (artifacts.has(entry.name)) {
              bytes += measure(absolute)
              fs.rmSync(absolute, { recursive: true, force: true })
              removed.push(displayPath(root, absolute))
              continue
            }
            if (shouldSkipDir(entry.name)) continue
            visit(absolute, depth + 1)
          }
        }
        visit(start, 0)
        return {
          removed,
          bytes,
          text: removed.length === 0
            ? `Nothing to clean under ${displayPath(root, start)}.`
            : `Removed ${removed.length} build director${removed.length === 1 ? 'y' : 'ies'} (${(bytes / 1024 / 1024).toFixed(1)} MB):\n${removed.join('\n')}`
        }
      }
    },

    {
      name: 'lcm_run_tests',
      description: 'Run a project\'s test command, detected from its manifest (npm test, pytest, cargo test, go test, dotnet test and so on).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project directory. Defaults to the workspace root.' },
          timeoutSeconds: { type: 'number', description: 'Wall-clock budget. Defaults to 600, capped at 3600.' }
        },
        required: []
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            command: { type: 'string' },
            exitCode: { type: 'number' },
            durationMs: { type: 'number' },
            timedOut: { type: 'boolean' },
            output: { type: 'string' }
          },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: value.output }]
      },
      async execute (args, exec) {
        const start = inside(args?.path ?? '.')
        if (statOrUndefined(start)?.isDirectory() !== true) throw new Error(`not a directory: ${displayPath(root, start)}`)
        const detected = detectProjects(start, 0, 1)
        const wanted = detected.find((entry) => entry.marker.test) ?? detected[0]
        if (!wanted?.marker.test) {
          throw new Error(`no test command is known for ${displayPath(root, start)}; no recognised manifest declares one`)
        }
        const timeoutMs = Math.min(Math.max(Number(args?.timeoutSeconds ?? 600), 5), 3600) * 1000
        const [executable, ...rest] = wanted.marker.test.split(' ')
        const result = await spawnCaptured(executable, rest, {
          cwd: wanted.directory,
          timeoutMs,
          maxChars: 120_000,
          signal: exec?.signal
        })
        const header = `${wanted.marker.test}  →  exit ${result.code}${result.timedOut ? ' (timed out)' : ''} in ${(result.durationMs / 1000).toFixed(1)}s`
        return {
          ok: result.code === 0 && !result.timedOut,
          command: wanted.marker.test,
          exitCode: result.code,
          durationMs: result.durationMs,
          timedOut: result.timedOut,
          output: `${header}\n\n${(result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : '')).slice(0, 100_000) || '(no output)'}`
        }
      }
    },

    {
      name: 'lcm_list_compilers',
      description: 'List the single-file compilers this tool can drive, and whether each one is installed.',
      parameters: { type: 'object', properties: {}, required: [] },
      output: {
        schema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: value.text }]
      },
      async execute () {
        const lines = []
        for (const [language, entry] of Object.entries(COMPILERS)) {
          const present = await commandExists(entry.command)
          lines.push(`${present ? 'ok     ' : 'missing'} ${language.padEnd(11)} ${entry.command}`)
        }
        return { text: lines.join('\n') }
      }
    },

    {
      name: 'lcm_compile_project',
      description: 'Compile one source file with the compiler for its language, or build a .NET project file. Reports the compiler\'s own diagnostics.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Source file (or .csproj) to compile.' },
          language: {
            type: 'string',
            enum: Object.keys(COMPILERS),
            description: 'Language of the file. Required — it decides which compiler runs.'
          },
          timeoutSeconds: { type: 'number', description: 'Wall-clock budget. Defaults to 300.' }
        },
        required: ['path', 'language']
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            command: { type: 'string' },
            exitCode: { type: 'number' },
            output: { type: 'string' }
          },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: value.output }]
      },
      async execute (args, exec) {
        const absolute = inside(args?.path)
        if (!statOrUndefined(absolute)) throw new Error(`file does not exist: ${displayPath(root, absolute)}`)
        const compiler = COMPILERS[String(args?.language ?? '')]
        if (!compiler) throw new Error(`unknown language "${args?.language}"; expected one of ${Object.keys(COMPILERS).join(', ')}`)
        const timeoutMs = Math.min(Math.max(Number(args?.timeoutSeconds ?? 300), 5), 3600) * 1000
        const result = await spawnCaptured(compiler.command, compiler.args(absolute), {
          cwd: path.dirname(absolute),
          timeoutMs,
          maxChars: 60_000,
          signal: exec?.signal
        })
        const command = `${compiler.command} ${compiler.args(absolute).join(' ')}`
        if (result.code === -1 && /spawn failed/.test(result.stderr)) {
          throw new Error(`${compiler.command} is not installed or not on PATH: ${result.stderr}`)
        }
        return {
          ok: result.code === 0,
          command,
          exitCode: result.code,
          output: `${command}  →  exit ${result.code} in ${(result.durationMs / 1000).toFixed(1)}s\n\n${(result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : '')).slice(0, 40_000) || '(no output)'}`
        }
      }
    },

    {
      name: 'lcm_run_native_command',
      description: 'Run an arbitrary executable on this machine and capture its output. This is NOT sandboxed: the command runs with your full user permissions and can touch anything you can, not just the workspace.',
      parameters: {
        type: 'object',
        properties: {
          executable: { type: 'string', description: 'Executable to run, resolved through PATH when not absolute.' },
          arguments: { type: 'array', items: { type: 'string' }, description: 'Command-line arguments, one per entry. No shell quoting needed.' },
          workingDirectory: { type: 'string', description: 'Directory to run in. Defaults to the workspace root.' },
          timeoutSeconds: { type: 'number', description: 'Wall-clock budget. Defaults to 300, capped at 7200.' },
          stdin: { type: 'string', description: 'Text to write to the process stdin, then close it.' }
        },
        required: ['executable']
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            exitCode: { type: 'number' },
            durationMs: { type: 'number' },
            timedOut: { type: 'boolean' },
            truncated: { type: 'boolean' },
            output: { type: 'string' }
          },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: value.output }]
      },
      async execute (args, exec) {
        const executable = String(args?.executable ?? '').trim()
        if (executable === '') throw new Error('executable is required')
        const argv = Array.isArray(args?.arguments) ? args.arguments.map(String) : []
        const cwd = args?.workingDirectory ? inside(args.workingDirectory) : path.resolve(root)
        if (statOrUndefined(cwd)?.isDirectory() !== true) throw new Error(`working directory does not exist: ${displayPath(root, cwd)}`)
        const timeoutMs = Math.min(Math.max(Number(args?.timeoutSeconds ?? 300), 5), 7200) * 1000
        const result = await spawnCaptured(executable, argv, {
          cwd,
          timeoutMs,
          maxChars: 200_000,
          signal: exec?.signal,
          stdin: typeof args?.stdin === 'string' ? args.stdin : undefined
        })
        const header = `${executable} ${argv.join(' ')}  →  exit ${result.code}${result.timedOut ? ' (timed out)' : ''} in ${(result.durationMs / 1000).toFixed(1)}s`
        const body = result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : '')
        return {
          ok: result.code === 0 && !result.timedOut,
          exitCode: result.code,
          durationMs: result.durationMs,
          timedOut: result.timedOut,
          truncated: result.truncated,
          output: `${header}\n\n${body.slice(0, 150_000) || '(no output)'}`
        }
      }
    }
  ]
}

export { PROJECT_MARKERS, COMPILERS, detectProjects }