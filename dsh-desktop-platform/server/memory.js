/**
 * The memory half: `MEMORY.md` per workspace root, the marked convention
 * block that tells an agent to maintain it, and the auto-written handoff note
 * a finished conversation leaves behind.
 *
 * `MEMORY.md` is already an instruction candidate the harness feeds to every
 * session in the workspace, so maintaining it needs no extra plumbing — which
 * is exactly why the convention toggle edits `AGENTS.md` rather than a
 * separate preference: the instruction has to reach the agent as text.
 *
 * @module dsh-desktop-workbench/server/memory
 */
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { join } from 'node:path'

import { parse as parseYaml } from 'yaml'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

import { confineRoot, readTextFile } from './workspace.js'
import { fail, isTrustedRequest, readJson, sendJson } from './http.js'

/** Loopback routes serving the memory tab. */
export const MEMORY_PATH = '/dsh-desktop/shell/memory'
export const CONVENTION_PATH = '/dsh-desktop/shell/convention'
export const HANDOFF_PATH = '/dsh-desktop/shell/handoff'

/** The per-workspace memory file the harness ingests as instructions. */
export const MEMORY_FILE = 'MEMORY.md'
/** The workspace instruction file the harness already ingests. */
export const AGENTS_FILE = 'AGENTS.md'
/** Marker that identifies the convention block this plugin owns. */
export const CONVENTION_MARKER = '<!-- anymore-memory -->'
const CONVENTION_BEGIN = '<!-- anymore-memory:start -->'
const CONVENTION_END = '<!-- anymore-memory:end -->'
/** Upper bound for one memory document write. */
const MAX_MEMORY_BYTES = 512 * 1024
/** Markers bracketing the auto-written handoff section inside MEMORY.md. */
const HANDOFF_BEGIN = '<!-- anymore-handoff:start -->'
const HANDOFF_END = '<!-- anymore-handoff:end -->'
/** Characters of transcript kept for one summary, anchored at the tail. */
const MAX_TRANSCRIPT_CHARS = 24000
/** Shortest transcript worth summarizing. */
const MIN_TRANSCRIPT_CHARS = 120
/** Output budget for one handoff note. */
const HANDOFF_MAX_TOKENS = 700
/** Abort budget for one summary round trip. */
const HANDOFF_TIMEOUT_MS = 60000

/** The convention block the agent follows to maintain the memory file. */
const CONVENTION_BODY = `${CONVENTION_BEGIN}
## 记忆维护约定（AnyMore）

- 会话中出现值得长期记住的事实（用户偏好、项目结构、构建与测试命令、纠正过的错误）时，把一行摘要追加到本目录的 MEMORY.md：不存在就创建，首行为 \`# 长期记忆\`，之后每行一条 \`- YYYY-MM-DD 内容\`。
- 每次会话开始时，若本目录存在 MEMORY.md，先读取并遵循其中已记录的内容。
- 只记结论与事实，不记过程；新事实与既有条目冲突时更新原条目，不追加重复项。
${CONVENTION_END}`

/** Read the harness settings document, tolerating an absent file. */
async function readSettingsDocument(home = resolveDshHome(process.env.DSH_HOME)) {
  const settingsPath = join(home, 'settings.yaml')
  try {
    const text = await readFile(settingsPath, 'utf8')
    return { settingsPath, document: parseYaml(text) ?? {} }
  } catch (error) {
    if (error === null || typeof error !== 'object' || error.code !== 'ENOENT') throw error
    return { settingsPath, document: {} }
  }
}

/** Map one runtime failure onto a state the Settings page can explain. */
function classifyProbeFailure(error, latencyMs) {
  const code = typeof error?.code === 'string' ? error.code : ''
  const reason = typeof error?.message === 'string' ? error.message : String(error)
  const failure = { latencyMs, error: reason }
  if (/MISSING_CREDENTIAL|NO_CREDENTIAL/.test(code)) return { ...failure, status: 'no-credential' }
  if (/AUTH|CREDENTIAL|UNAUTHORIZED|FORBIDDEN|\b401\b|\b403\b/.test(code + ' ' + reason)) return { ...failure, status: 'auth-error' }
  if (/NO_ADAPTER|NOT_REGISTERED|UNREGISTERED|unknown provider/i.test(code + ' ' + reason)) return { ...failure, status: 'not-registered' }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|TIMEDOUT|TIMEOUT|NETWORK|fetch failed/i.test(reason)) return { ...failure, status: 'unreachable' }
  return { ...failure, status: 'error' }
}

/**
 * The failure a terminal chunk carries, when the chunk ends the call badly.
 *
 * Failures arrive as a `finish` chunk whose reason is a *tagged object* —
 * `kind` is the discriminator, never a bare string — so comparing `reason`
 * against a string silently treats every failure as a success.
 */
function chunkFailure(chunk) {
  if (chunk === null || typeof chunk !== 'object') return undefined
  const reason = chunk.type === 'finish' ? chunk.reason : undefined
  if (reason === null || typeof reason !== 'object') return undefined
  if (reason.kind !== 'error' && reason.kind !== 'aborted') return undefined
  return { ...(reason.failure ?? {}), message: reason.failure?.message ?? `the stream finished with kind "${reason.kind}"` }
}

/** Read one workspace's memory file plus its convention state. */
export async function readMemory(root) {
  const content = await readTextFile(join(root, MEMORY_FILE))
  const agents = await readTextFile(join(root, AGENTS_FILE))
  return {
    root,
    memoryPath: join(root, MEMORY_FILE),
    agentsPath: join(root, AGENTS_FILE),
    exists: content !== null,
    content: content ?? '',
    convention: agents !== null && agents.includes(CONVENTION_BEGIN)
  }
}

/** Write one workspace's memory file. */
export async function writeMemory(root, content) {
  const body = typeof content === 'string' ? content : ''
  if (Buffer.byteLength(body, 'utf8') > MAX_MEMORY_BYTES) {
    throw new Error(`memory document exceeds ${Math.round(MAX_MEMORY_BYTES / 1024)} KiB`)
  }
  await writeFile(join(root, MEMORY_FILE), body, 'utf8')
}

/** Add or remove the convention block in one workspace's AGENTS.md. */
export async function writeConvention(root, enabled) {
  const agentsPath = join(root, AGENTS_FILE)
  const current = await readTextFile(agentsPath)
  const text = current ?? ''
  if (enabled) {
    if (text.includes(CONVENTION_BEGIN)) return { changed: false }
    const separator = text.length === 0 ? '' : (text.endsWith('\n') ? '\n' : '\n\n')
    await writeFile(agentsPath, `${text}${separator}${CONVENTION_BODY}\n`, 'utf8')
    return { changed: true }
  }
  if (!text.includes(CONVENTION_BEGIN)) return { changed: false }
  const stripped = text
    .replace(new RegExp(`\\n?${CONVENTION_BEGIN.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}[\\s\\S]*?${CONVENTION_END}\\n?`, 'g'), '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/, '\n')
  if (stripped.trim() === '') {
    // The file held nothing but the convention block, so it only exists
    // because the convention was turned on. Removing it restores the
    // workspace to its pre-convention state instead of leaving an empty file.
    await unlink(agentsPath).catch(() => undefined)
    return { changed: true }
  }
  await writeFile(agentsPath, stripped, 'utf8')
  return { changed: true }
}

/** The instruction the summarizer follows. */
const HANDOFF_PROMPT = [
  '你是会话交接摘要生成器。下面是一段刚刚结束的会话记录。',
  '请为「下一个接手的新会话」写一份简短交接说明，用中文，包含四段：',
  '1. 目标与背景（1-2 句）',
  '2. 已完成的关键动作（最多 6 条要点，含具体文件路径与结论）',
  '3. 当前状态、未决问题与已知坑',
  '4. 建议的下一步',
  '只输出交接内容本身（Markdown），不要寒暄、不要复述原文、不要出现"根据会话记录"这类开头。控制在 400 字以内。'
].join('\n')

/** Keep the tail of a transcript: the newest turns carry the live state. */
function trimTranscript(transcript) {
  const body = typeof transcript === 'string' ? transcript.trim() : ''
  if (body.length <= MAX_TRANSCRIPT_CHARS) return body
  return `…（前文已省略）\n${body.slice(-MAX_TRANSCRIPT_CHARS)}`
}

/**
 * One summary round trip.
 *
 * The text is assembled from `text-delta` chunks because the runtime has no
 * "final answer" accessor, and a terminal `finish` chunk is the only failure
 * signal — there is no error chunk type.
 */
async function runSummary(llm, provider, model, prompt) {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HANDOFF_TIMEOUT_MS)
  try {
    const stream = llm.stream({
      provider,
      model,
      maxTokens: HANDOFF_MAX_TOKENS,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      signal: controller.signal
    })
    const parts = []
    for await (const chunk of stream) {
      const failure = chunkFailure(chunk)
      if (failure !== undefined) {
        const classified = classifyProbeFailure(failure, Date.now() - startedAt)
        return { status: classified.status, error: classified.error, summary: null }
      }
      if (chunk !== null && typeof chunk === 'object' && chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        parts.push(chunk.text)
      }
    }
    const summary = parts.join('').trim()
    if (summary.length === 0) return { status: 'empty', summary: null }
    return { status: 'ok', summary, provider, model, latencyMs: Date.now() - startedAt }
  } catch (error) {
    const classified = classifyProbeFailure(error, Date.now() - startedAt)
    return { status: classified.status, error: classified.error, summary: null }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Summarize one finished conversation into a handoff note.
 *
 * The note is generated with the agent's own default model through the same
 * runtime the probe uses, so credentials come from `.credentials.yaml` rather
 * than the environment. A default selection can still name a model the account
 * may not call (the harness keeps the agent's choice, not a capability check),
 * so one retry falls back to the first model that provider's catalog offers —
 * summarization is the least model-sensitive task there is.
 */
export async function summarizeHandoff(llm, home, { title, transcript }) {
  const body = trimTranscript(transcript)
  if (body.length < MIN_TRANSCRIPT_CHARS) return { status: 'too-short', summary: null }
  if (llm === null || llm === undefined || typeof llm.stream !== 'function') {
    return { status: 'runtime-unavailable', summary: null }
  }
  const { document: document_ } = await readSettingsDocument(home)
  const selection = document_['agent-default-model']
  const provider = typeof selection?.provider === 'string' ? selection.provider : null
  const model = typeof selection?.model === 'string' ? selection.model : null
  if (provider === null || model === null) return { status: 'no-model', summary: null }
  const prompt = `${HANDOFF_PROMPT}\n\n会话标题：${typeof title === 'string' && title.length > 0 ? title : '（无标题）'}\n\n会话记录：\n${body}`
  const primary = await runSummary(llm, provider, model, prompt)
  if (primary.summary !== null) return primary
  const fallback = await firstCatalogModel(llm, provider, model)
  if (fallback === null) return primary
  const retry = await runSummary(llm, provider, fallback, prompt)
  return retry.summary === null ? primary : { ...retry, fallbackModel: fallback }
}

/** The first catalog model that is not the one that just failed. */
async function firstCatalogModel(llm, provider, except) {
  try {
    const models = await llm.listModels(provider)
    for (const entry of models) {
      const id = entry?.id
      if (typeof id === 'string' && id.length > 0 && id !== except) return id
    }
  } catch {
    // No catalog to fall back on: the primary failure stands on its own.
  }
  return null
}

/** The generated section as it is stored inside MEMORY.md. */
function handoffBlock({ sessionId, title, summary, generatedAt }) {
  const stamp = new Date(generatedAt).toISOString().slice(0, 16).replace('T', ' ')
  const lines = [
    HANDOFF_BEGIN,
    `## 上一会话交接（${stamp} · ${typeof title === 'string' && title.length > 0 ? title : '未命名会话'}）`,
    '',
    '_以下由 harness 自动生成，供新会话接续参考；与当前任务无关时可忽略。_',
    '',
    summary.trim(),
    HANDOFF_END
  ]
  return `\n${lines.join('\n')}\n`
}

/** Read the handoff section currently stored in one workspace's MEMORY.md. */
export async function readHandoff(root) {
  const content = await readTextFile(join(root, MEMORY_FILE))
  const text = content ?? ''
  const begin = text.indexOf(HANDOFF_BEGIN)
  const end = text.indexOf(HANDOFF_END, begin + 1)
  if (begin === -1 || end === -1) return { root, exists: false, content: '', summary: '', generatedAt: null }
  const section = text.slice(begin, end + HANDOFF_END.length)
  const stamp = /（(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/.exec(section)
  return {
    root,
    exists: true,
    content: section,
    summary: text.slice(begin + HANDOFF_BEGIN.length, end).trim(),
    generatedAt: stamp === null ? null : Date.parse(`${stamp[1].replace(' ', 'T')}:00Z`)
  }
}

/**
 * Write or replace the handoff section in one workspace's MEMORY.md.
 *
 * Only the bracketed section is touched: the rest of the file is the user's own
 * long-term memory, which this write must leave exactly as it found it.
 */
export async function writeHandoff(root, entry) {
  const current = await readTextFile(join(root, MEMORY_FILE))
  const text = current ?? ''
  const head = current === null ? '# 长期记忆\n' : ''
  const begin = text.indexOf(HANDOFF_BEGIN)
  const end = text.indexOf(HANDOFF_END, begin + 1)
  const stripped = begin === -1 || end === -1
    ? text.replace(/\s+$/, '')
    : `${text.slice(0, begin).replace(/\s+$/, '')}\n${text.slice(end + HANDOFF_END.length).replace(/^\s+/, '')}`
  const body = stripped.trim() === ''
    ? `${head.trim()}\n`
    : `${stripped.replace(/\s+$/, '\n')}`
  const next = `${body}${body.endsWith('\n') ? '' : '\n'}${handoffBlock(entry)}`
  if (Buffer.byteLength(next, 'utf8') > MAX_MEMORY_BYTES) {
    throw new Error(`memory document exceeds ${Math.round(MAX_MEMORY_BYTES / 1024)} KiB`)
  }
  await writeFile(join(root, MEMORY_FILE), next, 'utf8')
  return { ok: true, memoryPath: join(root, MEMORY_FILE) }
}

/**
 * Mount the memory document, the convention toggle, and the handoff note.
 *
 * Every request that names a root is confined to the registry's own roots
 * first: the path arrives from the browser, so it is never a fact.
 * @param table - the route table of the mounted web server.
 * @param webCtx - the fiber carrying `logger`.
 * @param registry - the host workspace registry.
 * @param llm - the model runtime, or undefined while the plane is absent.
 */
export function registerMemoryRoutes(table, webCtx, registry, llm) {
  table.add(MEMORY_PATH, async (req, res) => {
    if (!isTrustedRequest(req)) return sendJson(res, 403, { error: 'Request rejected.' })
    const url = new URL(req.url, 'http://localhost')
    if (req.method === 'GET') {
      const root = confineRoot(registry, url.searchParams.get('root'))
      if (root === null) return sendJson(res, 400, { error: 'Unknown workspace root.' })
      try {
        sendJson(res, 200, await readMemory(root))
      } catch (error) {
        fail(webCtx, res, error)
      }
      return
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' })
    const body = await readJson(req)
    const root = confineRoot(registry, body?.root)
    if (root === null) return sendJson(res, 400, { error: 'Unknown workspace root.' })
    if (typeof body.content !== 'string') return sendJson(res, 400, { error: 'content is required.' })
    try {
      await writeMemory(root, body.content)
      sendJson(res, 200, { ok: true })
    } catch (error) {
      fail(webCtx, res, error)
    }
  })

  table.add(HANDOFF_PATH, async (req, res) => {
    if (!isTrustedRequest(req)) return sendJson(res, 403, { error: 'Request rejected.' })
    const url = new URL(req.url, 'http://localhost')
    if (req.method === 'GET') {
      const root = confineRoot(registry, url.searchParams.get('root'))
      if (root === null) return sendJson(res, 400, { error: 'Unknown workspace root.' })
      try {
        sendJson(res, 200, await readHandoff(root))
      } catch (error) {
        fail(webCtx, res, error)
      }
      return
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' })
    const body = await readJson(req)
    const root = confineRoot(registry, body?.root)
    if (root === null) return sendJson(res, 400, { error: 'Unknown workspace root.' })
    if (typeof body.transcript !== 'string') return sendJson(res, 400, { error: 'transcript is required.' })
    try {
      const result = await summarizeHandoff(llm, resolveDshHome(process.env.DSH_HOME), {
        title: typeof body.title === 'string' ? body.title : null,
        transcript: body.transcript
      })
      if (result.summary === null) return sendJson(res, 200, { ok: false, ...result })
      const written = await writeHandoff(root, {
        sessionId: typeof body.sessionId === 'string' ? body.sessionId : null,
        title: typeof body.title === 'string' ? body.title : null,
        summary: result.summary,
        generatedAt: Date.now()
      })
      sendJson(res, 200, { ok: true, ...result, memoryPath: written.memoryPath })
    } catch (error) {
      fail(webCtx, res, error)
    }
  })

  table.add(CONVENTION_PATH, async (req, res) => {
    if (!table.post(req, res)) return
    const body = await readJson(req)
    const root = confineRoot(registry, body?.root)
    if (root === null) return sendJson(res, 400, { error: 'Unknown workspace root.' })
    if (typeof body.enabled !== 'boolean') return sendJson(res, 400, { error: 'enabled is required.' })
    try {
      sendJson(res, 200, { ok: true, ...(await writeConvention(root, body.enabled)) })
    } catch (error) {
      fail(webCtx, res, error)
    }
  })
}