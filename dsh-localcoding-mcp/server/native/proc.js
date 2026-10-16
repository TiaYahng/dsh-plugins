/**
 * Process execution for the native tools.
 *
 * One helper, two consumers: the command tools (`run_native_command`, `run_tests`,
 * `build_project`) want a bounded, captured result, and the session tools
 * (`spawn_process`, `read_process_output`) want a long-lived child they can talk to.
 * Both go through `spawnCaptured` so timeout handling, output limits, and tree
 * killing exist in exactly one place.
 *
 * Windows note: `child.kill()` signals only the direct child, and a build tool
 * spawns compilers of its own that keep the inherited pipes open. Without
 * `taskkill /T /F` a timed-out build leaks the whole tree and the promise does not
 * settle — measured at 105 s for a 20 s budget before this was handled.
 */

import { spawn } from 'node:child_process'
import process from 'node:process'

/** Kill a child and every process it started. */
export function killTree (child) {
  if (!child?.pid) return
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      }).unref()
      return
    } catch {
      // fall through to the plain kill below
    }
  }
  try { child.kill('SIGKILL') } catch { /* already gone */ }
}

/**
 * Run a command to completion with captured output.
 *
 * The promise settles exactly once. A timeout resolves with `timedOut: true`
 * rather than rejecting, because "the build took too long" is a result the caller
 * has to report, not an exception.
 *
 * @param {string} command executable, resolved through PATH when not absolute
 * @param {string[]} args
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxChars] per-stream capture limit
 * @param {AbortSignal} [options.signal]
 * @param {object} [options.env]
 * @param {string} [options.stdin] written then closed
 * @returns {Promise<{code:number, stdout:string, stderr:string, timedOut:boolean, durationMs:number, truncated:boolean}>}
 */
export function spawnCaptured (command, args, options = {}) {
  const {
    cwd,
    timeoutMs = 120_000,
    maxChars = 200_000,
    signal,
    env,
    stdin
  } = options

  return new Promise((resolve) => {
    const startedAt = Date.now()
    let child
    try {
      child = spawn(command, args, {
        cwd,
        env: env ?? process.env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (error) {
      resolve({
        code: -1,
        stdout: '',
        stderr: `spawn failed: ${error.message}`,
        timedOut: false,
        durationMs: Date.now() - startedAt,
        truncated: false
      })
      return
    }

    let stdout = ''
    let stderr = ''
    let truncated = false
    let timedOut = false
    let settled = false

    const capture = (target, chunk) => {
      if (target.length >= maxChars) { truncated = true; return target }
      const text = chunk.toString('utf8')
      if (target.length + text.length > maxChars) {
        truncated = true
        return target + text.slice(0, maxChars - target.length)
      }
      return target + text
    }

    const finish = (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      resolve({ code, stdout, stderr, timedOut, durationMs: Date.now() - startedAt, truncated })
    }

    child.stdout?.on('data', (chunk) => { stdout = capture(stdout, chunk) })
    child.stderr?.on('data', (chunk) => { stderr = capture(stderr, chunk) })

    const onAbort = () => {
      killTree(child)
      finish(-1)
    }

    // `close` waits for the inherited pipes to drain, which a grandchild can hold
    // open indefinitely; `exit` reports the actual child ending. Whichever lands
    // first settles the promise, so a leaked pipe cannot stall the caller.
    child.on('exit', (code) => {
      killTree(child)
      finish(code ?? -1)
    })
    child.on('close', (code) => finish(code ?? -1))
    child.on('error', (error) => {
      stderr = `${stderr}\n${error.message}`.trim()
      finish(-1)
    })

    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
      finish(-1)
    }, Math.max(1_000, timeoutMs))
    timer.unref?.()

    if (signal) {
      if (signal.aborted) { onAbort(); return }
      signal.addEventListener?.('abort', onAbort, { once: true })
    }

    try {
      child.stdin?.end(stdin ?? '')
    } catch {
      // A child that never reads stdin can still have closed it first.
    }
  })
}

/** Run `git` in a directory and return its stdout, or throw with git's own words. */
export async function git (cwd, args, options = {}) {
  const result = await spawnCaptured('git', args, { cwd, timeoutMs: options.timeoutMs ?? 60_000, maxChars: options.maxChars })
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim()
    throw new Error(`git ${args.join(' ')} failed (exit ${result.code}): ${detail.slice(0, 800)}`)
  }
  return result.stdout
}

/** Whether `command` resolves on PATH. Used by the build-tool detectors. */
export async function commandExists (command) {
  const probe = process.platform === 'win32' ? 'where' : 'which'
  const result = await spawnCaptured(probe, [command], { timeoutMs: 8_000, maxChars: 4_000 })
  return result.code === 0
}