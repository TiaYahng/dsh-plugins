/**
 * Long-lived process sessions, reimplemented natively.
 *
 * A build or a dev server outlives one tool call, so the model needs to start it,
 * read what it printed, type at it, and stop it. That is a stateful registry held
 * for the plugin's lifetime, with a hard cap on how many children may exist at
 * once and a reaper that drops finished ones after their output is no longer
 * useful.
 *
 * The registry is the reason this is not just `spawn`: an unkillable process is a
 * resource leak the user cannot see, and every session here is either reaped on
 * exit or killed with the plugin.
 */

import { spawn } from 'node:child_process'
import process from 'node:process'

import { killTree } from './proc.js'
import { displayPath, resolveInside, statOrUndefined } from './paths.js'

/** Concurrency ceiling: enough for a real workflow, low enough to stay debuggable. */
const MAX_SESSIONS = 12
/** Output kept per session, so a chatty server cannot grow the heap without bound. */
const MAX_BUFFER_CHARS = 400_000
/** Finished sessions are removed once, and stay readable for this long. */
const REAP_AFTER_MS = 10 * 60 * 1000

/** A single running or finished child process. */
class ProcessSession {
  constructor ({ id, command, args, cwd, child }) {
    this.id = id
    this.command = command
    this.args = args
    this.cwd = cwd
    this.child = child
    this.pid = child.pid
    this.startedAt = Date.now()
    this.exitedAt = undefined
    this.exitCode = undefined
    this.truncated = false
    this.stdout = ''
    this.stderr = ''
    /** Byte offset the caller has already read, so reads are incremental. */
    this.stdoutRead = 0
    this.stderrRead = 0
    child.stdout?.on('data', (chunk) => { this.#append('stdout', chunk) })
    child.stderr?.on('data', (chunk) => { this.#append('stderr', chunk) })
    child.on('exit', (code) => {
      this.exitedAt = Date.now()
      this.exitCode = code ?? -1
    })
    child.on('error', (error) => {
      this.#append('stderr', Buffer.from(`\n${error.message}\n`))
      this.exitedAt = Date.now()
      this.exitCode = -1
    })
  }

  #append (stream, chunk) {
    const text = chunk.toString('utf8')
    const next = this[stream] + text
    if (next.length > MAX_BUFFER_CHARS) {
      this.truncated = true
      this[stream] = next.slice(next.length - MAX_BUFFER_CHARS)
      // Slicing invalidates the caller's offset; clamp it so reads stay coherent.
      this[`${stream}Read`] = Math.max(0, Math.min(this[`${stream}Read`], this[stream].length))
      return
    }
    this[stream] = next
  }

  get running () {
    return this.exitedAt === undefined
  }

  /** Everything appended since the last read, per stream. */
  drain () {
    const stdout = this.stdout.slice(this.stdoutRead)
    const stderr = this.stderr.slice(this.stderrRead)
    this.stdoutRead = this.stdout.length
    this.stderrRead = this.stderr.length
    return { stdout, stderr }
  }

  describe () {
    return {
      sessionId: this.id,
      command: [this.command, ...this.args].join(' '),
      cwd: this.cwd,
      pid: this.pid,
      running: this.running,
      exitCode: this.exitCode,
      startedAt: new Date(this.startedAt).toISOString(),
      durationMs: (this.exitedAt ?? Date.now()) - this.startedAt
    }
  }

  kill () {
    if (this.running) killTree(this.child)
  }
}

/**
 * Registry of process sessions, owned by the plugin.
 *
 * @param {{workspaceRoot: string, logger?: object}} deps
 */
export function createProcessRegistry (deps) {
  const root = deps.workspaceRoot
  /** @type {Map<string, ProcessSession>} */
  const sessions = new Map()
  const order = []
  let counter = 0

  const inside = (candidate) => resolveInside(root, candidate)

  /** Drop sessions that exited a while ago so the list stays meaningful. */
  const reap = () => {
    const cutoff = Date.now() - REAP_AFTER_MS
    for (const [id, session] of sessions) {
      if (session.running) continue
      if ((session.exitedAt ?? 0) > cutoff) continue
      sessions.delete(id)
      const index = order.indexOf(id)
      if (index >= 0) order.splice(index, 1)
    }
  }

  return {
    /** Every live or recently finished session, oldest first. */
    list () {
      reap()
      return order.map((id) => sessions.get(id)).filter(Boolean)
    },

    get (id) {
      return sessions.get(id)
    },

    /**
     * Start a child and register it.
     *
     * @returns {ProcessSession}
     * @throws when the session cap is reached
     */
    spawn ({ executable, args = [], cwd, env }) {
      reap()
      if (sessions.size >= MAX_SESSIONS) {
        const running = [...sessions.values()].filter((session) => session.running).length
        throw new Error(`${MAX_SESSIONS} process sessions are already tracked (${running} still running); kill one with lcm_kill_process first`)
      }
      const child = spawn(executable, args, {
        cwd,
        env: env ?? process.env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      const id = `proc-${++counter}`
      const session = new ProcessSession({ id, command: executable, args, cwd, child })
      sessions.set(id, session)
      order.push(id)
      return session
    },

    kill (id) {
      const session = sessions.get(id)
      if (!session) return undefined
      session.kill()
      return session
    },

    /** Kill everything. Never throws, so one stubborn child cannot block teardown. */
    dispose () {
      for (const session of sessions.values()) {
        try {
          session.kill()
        } catch {
          // Teardown must reach the remaining sessions.
        }
      }
      sessions.clear()
      order.length = 0
    }
  }
}

/**
 * Build the process-session tools.
 *
 * @param {{workspaceRoot: string, logger?: object}} deps
 */
export function createProcessTools (deps) {
  const root = deps.workspaceRoot
  const registry = createProcessRegistry(deps)
  const inside = (candidate) => resolveInside(root, candidate)

  const tools = [
    {
      name: 'lcm_spawn_process',
      description: 'Start a long-running process (a dev server, a watcher, an interactive tool) and return a session id for reading its output and stopping it. The process keeps running until you kill it or the plugin unloads.',
      parameters: {
        type: 'object',
        properties: {
          executable: { type: 'string', description: 'Executable to run, resolved through PATH when not absolute.' },
          arguments: { type: 'array', items: { type: 'string' }, description: 'Command-line arguments, one per entry.' },
          workingDirectory: { type: 'string', description: 'Directory to run in. Defaults to the workspace root.' },
          env: {
            type: 'object',
            additionalProperties: true,
            description: 'Extra environment variables merged over the current process environment.'
          },
          waitSeconds: { type: 'number', description: 'How long to wait before returning, so early output is already buffered. Defaults to 2.' }
        },
        required: ['executable']
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            pid: { type: 'number' },
            running: { type: 'boolean' },
            exitCode: { type: 'number' },
            output: { type: 'string' }
          },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: value.output }]
      },
      async execute (args) {
        const executable = String(args?.executable ?? '').trim()
        if (executable === '') throw new Error('executable is required')
        const argv = Array.isArray(args?.arguments) ? args.arguments.map(String) : []
        const cwd = args?.workingDirectory ? inside(args.workingDirectory) : root
        if (statOrUndefined(cwd)?.isDirectory() !== true) throw new Error(`working directory does not exist: ${displayPath(root, cwd)}`)
        const env = args?.env && typeof args.env === 'object'
          ? { ...process.env, ...Object.fromEntries(Object.entries(args.env).map(([key, entry]) => [key, String(entry)])) }
          : process.env
        const session = registry.spawn({ executable, args: argv, cwd, env })
        const waitMs = Math.min(Math.max(Number(args?.waitSeconds ?? 2) * 1000, 0), 30_000)
        if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs))
        const { stdout, stderr } = session.drain()
        const head = `${session.id}  pid ${session.pid}  ${session.running ? 'running' : `exited ${session.exitCode}`}`
        const body = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).slice(0, 20_000)
        return {
          sessionId: session.id,
          pid: session.pid,
          running: session.running,
          exitCode: session.exitCode,
          output: `${head}\n\n${body || '(no output yet)'}`
        }
      }
    },

    {
      name: 'lcm_list_processes',
      description: 'List the process sessions this tool started, with pid, running state, exit code and how long each has been alive.',
      parameters: { type: 'object', properties: {}, required: [] },
      output: {
        schema: {
          type: 'object',
          properties: {
            count: { type: 'number' },
            sessions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sessionId: { type: 'string' },
                  command: { type: 'string' },
                  pid: { type: 'number' },
                  running: { type: 'boolean' },
                  exitCode: { type: 'number' },
                  durationMs: { type: 'number' }
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
        const sessions = registry.list()
        if (sessions.length === 0) return { count: 0, sessions: [], text: 'No process sessions.' }
        const described = sessions.map((session) => session.describe())
        const lines = described.map((entry) => {
          const age = `${(entry.durationMs / 1000).toFixed(1)}s`
          return `${entry.sessionId}  ${entry.running ? 'running' : `exited ${entry.exitCode}`.padEnd(9)}  ${age.padStart(8)}  pid ${entry.pid}  ${entry.command}`
        })
        return { count: described.length, sessions: described, text: lines.join('\n') }
      }
    },

    {
      name: 'lcm_read_process_output',
      description: 'Read whatever a process session printed since the last read. Reads are incremental, so calling this twice does not repeat output.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session id from lcm_spawn_process.' },
          maxBytes: { type: 'number', description: 'Character cap on this read. Defaults to 20000.' },
          waitSeconds: { type: 'number', description: 'Wait this long for new output before returning. Defaults to 0.' }
        },
        required: ['sessionId']
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            sessionId: { type: 'string' },
            running: { type: 'boolean' },
            exitCode: { type: 'number' },
            output: { type: 'string' }
          },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: value.output }]
      },
      async execute (args) {
        const session = registry.get(String(args?.sessionId ?? ''))
        if (!session) throw new Error(`unknown session: ${args?.sessionId} (it may have been reaped after finishing)`)
        const waitMs = Math.min(Math.max(Number(args?.waitSeconds ?? 0) * 1000, 0), 60_000)
        if (waitMs > 0 && session.running) {
          const deadline = Date.now() + waitMs
          while (Date.now() < deadline && session.running && session.stdoutRead === session.stdout.length) {
            await new Promise((resolve) => setTimeout(resolve, 200))
          }
        }
        const maxChars = Math.min(Math.max(Number(args?.maxBytes) || 20_000, 100), 200_000)
        const { stdout, stderr } = session.drain()
        const body = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).slice(0, maxChars)
        const head = `${session.id}  ${session.running ? 'running' : `exited ${session.exitCode}`}`
        return {
          sessionId: session.id,
          running: session.running,
          exitCode: session.exitCode,
          output: `${head}\n\n${body || '(no new output)'}`
        }
      }
    },

    {
      name: 'lcm_write_process_stdin',
      description: 'Write text to a running process session\'s stdin, for tools that ask questions on the terminal.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session id from lcm_spawn_process.' },
          input: { type: 'string', description: 'Text to write. A newline is added unless newline is false.' },
          newline: { type: 'boolean', description: 'Append a newline. Defaults to true.' }
        },
        required: ['sessionId', 'input']
      },
      output: {
        schema: {
          type: 'object',
          properties: { sessionId: { type: 'string' }, bytes: { type: 'number' }, text: { type: 'string' } },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: value.text }]
      },
      async execute (args) {
        const session = registry.get(String(args?.sessionId ?? ''))
        if (!session) throw new Error(`unknown session: ${args?.sessionId}`)
        if (!session.running) throw new Error(`session ${session.id} already exited (${session.exitCode}); nothing is reading stdin`)
        if (typeof args?.input !== 'string') throw new Error('input must be a string')
        const payload = args?.newline === false ? args.input : `${args.input}\n`
        await new Promise((resolve, reject) => {
          session.child.stdin.write(payload, (error) => (error ? reject(error) : resolve()))
        })
        return {
          sessionId: session.id,
          bytes: Buffer.byteLength(payload, 'utf8'),
          text: `Wrote ${Buffer.byteLength(payload, 'utf8')} bytes to ${session.id}.`
        }
      }
    },

    {
      name: 'lcm_kill_process',
      description: 'Stop a process session and everything it spawned. Safe to call on a session that already exited.',
      parameters: {
        type: 'object',
        properties: { sessionId: { type: 'string', description: 'Session id from lcm_spawn_process.' } },
        required: ['sessionId']
      },
      output: {
        schema: {
          type: 'object',
          properties: { sessionId: { type: 'string' }, wasRunning: { type: 'boolean' }, text: { type: 'string' } },
          additionalProperties: false
        },
        render: (_args, value) => [{ type: 'text', text: value.text }]
      },
      async execute (args) {
        const session = registry.get(String(args?.sessionId ?? ''))
        if (!session) throw new Error(`unknown session: ${args?.sessionId}`)
        const wasRunning = session.running
        session.kill()
        return {
          sessionId: session.id,
          wasRunning,
          text: wasRunning ? `Killed ${session.id} (pid ${session.pid}) and its children.` : `${session.id} had already exited (${session.exitCode}).`
        }
      }
    }
  ]

  // The registry outlives individual calls but not the plugin; expose it so the
  // plugin's disposer can guarantee no child survives an unload.
  return { tools, registry }
}

export { ProcessSession, MAX_SESSIONS, MAX_BUFFER_CHARS }