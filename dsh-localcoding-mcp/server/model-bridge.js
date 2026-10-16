/**
 * An OpenAI-compatible endpoint backed by this app's own model access.
 *
 * This module is the answer to "bridge Codex to this application's model entry".
 * Codex (and anything else that speaks the OpenAI wire protocol) needs a
 * `base_url`; this app already has model access through the host `llm` service.
 * So the plugin serves `/v1/chat/completions` and `/v1/models` on loopback, and
 * translates each request into one `llm.stream()` call.
 *
 * What that buys, and why it is the right shape:
 *
 *   - Codex stops needing a third-party relay, an API key, or `codex login`. The
 *     model it talks to is whichever provider/model this app is already configured
 *     with, so "the model I use in the app" and "the model Codex uses" are one
 *     thing, not two.
 *   - The credential never leaves the host: the plugin holds no key, and the
 *     OpenAI-shaped request arriving from Codex carries a token that is accepted
 *     and ignored.
 *
 * Two honesty constraints are enforced here rather than documented and forgotten:
 *
 *   1. **Loopback only.** The route refuses anything without a loopback socket
 *      address, and additionally requires `isTrustedRequest`, so an off-machine
 *      caller cannot use this app as a free model proxy.
 *   2. **Streaming is real.** Codex renders tokens as they arrive; buffering the
 *      whole answer and then emitting one chunk would make it look hung. The
 *      `StreamChunk` vocabulary maps onto SSE deltas one for one.
 */

import { Buffer } from 'node:buffer'

/** Model id Codex asks for when it does not know better; we route by config. */
const DEFAULT_MODEL_ID = 'dsh-harness'

/**
 * Translate one OpenAI `messages` array into the host's message vocabulary.
 *
 * The host speaks `{ id, role, content: ContentBlock[], source }`, while OpenAI
 * speaks either a plain string or an array of typed parts. Two details are easy to
 * get wrong and are load-bearing:
 *
 *   - `ToolCallBlock.arguments` is a **JSON string**, not a parsed object, so it is
 *     passed through verbatim rather than re-serialised.
 *   - a tool result is a `role: 'tool'` message carrying BOTH `toolCallId` and
 *     `source: {kind:'tool', callId}`, because the adapters read them separately.
 *
 * Tool traffic is carried across rather than dropped, so a Codex tool-calling loop
 * survives the translation instead of degrading into a text-only conversation.
 *
 * @param {Array<object>} messages OpenAI-shaped messages
 * @param {(index: number) => string} nextId id generator for the host's MessageId
 * @returns {Array<object>} host-shaped messages
 */
export function toHostMessages (messages, nextId = (index) => `m${index}`) {
  const out = []
  let index = 0
  for (const message of Array.isArray(messages) ? messages : []) {
    const role = message?.role
    if (role === 'system' || role === 'developer') continue // hoisted into `system`
    if (role === 'tool') {
      const callId = String(message?.tool_call_id ?? '')
      const text = typeof message?.content === 'string'
        ? message.content
        : JSON.stringify(message?.content ?? '')
      out.push({
        id: nextId(index++),
        role: 'tool',
        toolCallId: callId,
        source: { kind: 'tool', callId },
        ...(message?.is_error ? { isError: true } : {}),
        content: [{ type: 'text', text }]
      })
      continue
    }
    if (role !== 'user' && role !== 'assistant') continue

    const blocks = []
    const content = message?.content
    if (typeof content === 'string') {
      if (content !== '') blocks.push({ type: 'text', text: content })
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part?.type === 'text' && typeof part.text === 'string') blocks.push({ type: 'text', text: part.text })
        else if (part?.type === 'image_url' && typeof part.image_url?.url === 'string') {
          const url = part.image_url.url
          const match = /^data:([^;]+);base64,(.*)$/.exec(url)
          if (match) blocks.push({ type: 'image', source: { type: 'base64', mediaType: match[1], data: match[2] } })
        }
      }
    }

    const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : []
    for (const call of toolCalls) {
      blocks.push({
        type: 'tool-call',
        id: String(call?.id ?? ''),
        name: String(call?.function?.name ?? ''),
        // Verbatim: the host declares this as a string and its adapters parse it.
        arguments: typeof call?.function?.arguments === 'string' ? call.function.arguments : JSON.stringify(call?.function?.arguments ?? {})
      })
    }

    if (blocks.length === 0) continue
    out.push({
      id: nextId(index++),
      role,
      content: blocks,
      source: role === 'assistant'
        ? { kind: 'model', provider: 'dsh-model-bridge', model: String(message?.model ?? DEFAULT_MODEL_ID) }
        : { kind: 'user' }
    })
  }
  return out
}

/** Collect the system text OpenAI sends as leading system/developer messages. */
export function toSystemPrompt (messages) {
  const parts = []
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.role !== 'system' && message?.role !== 'developer') continue
    if (typeof message.content === 'string') parts.push(message.content)
    else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part?.type === 'text' && typeof part.text === 'string') parts.push(part.text)
      }
    }
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

/**
 * Translate OpenAI `tools` into the host's tool schema vocabulary.
 *
 * The host accepts the same three fields OpenAI uses, so this is mostly a rename
 * plus dropping anything the host's schema subset would reject.
 */
export function toHostTools (tools) {
  if (!Array.isArray(tools)) return undefined
  const out = []
  for (const tool of tools) {
    const fn = tool?.function
    if (!fn?.name || typeof fn.name !== 'string') continue
    out.push({
      name: fn.name,
      description: typeof fn.description === 'string' ? fn.description : '',
      parameters: fn.parameters && typeof fn.parameters === 'object' ? fn.parameters : { type: 'object', properties: {} }
    })
  }
  return out.length > 0 ? out : undefined
}

/** OpenAI's finish_reason vocabulary, mapped from the host's. */
function toFinishReason (reason) {
  switch (reason) {
    case 'stop': return 'stop'
    case 'max-tokens': return 'length'
    case 'tool-calls':
    case 'tool_call': return 'tool_calls'
    default: return 'stop'
  }
}

/**
 * Fold a host `StreamChunk` sequence into OpenAI SSE frames.
 *
 * Kept separate from the HTTP layer so it can be tested without a server: feed it
 * chunks, collect the strings it yields, assert on them.
 *
 * @param {AsyncIterable<object>} chunks
 * @param {{id: string, model: string, created: number, includeUsage?: boolean}} meta
 * @returns {AsyncGenerator<string>} SSE payloads, already `data: `-framed
 */
export async function * toOpenAiStream (chunks, meta) {
  let index = 0
  let usage
  const toolIndexes = new Map()
  let nextToolIndex = 0

  const frame = (delta, finishReason) => `data: ${JSON.stringify({
    id: meta.id,
    object: 'chat.completion.chunk',
    created: meta.created,
    model: meta.model,
    choices: [{ index: 0, delta, finish_reason: finishReason ?? null }]
  })}\n\n`

  yield frame({ role: 'assistant', content: '' })

  for await (const chunk of chunks) {
    switch (chunk?.type) {
      case 'text-delta':
        if (chunk.text) yield frame({ content: chunk.text })
        break
      case 'reasoning-delta':
        // Surfaced as a separate field rather than mixed into content: a client
        // that ignores it sees clean output, and one that knows it can show it.
        if (chunk.text) yield frame({ reasoning_content: chunk.text })
        break
      case 'tool-call-delta': {
        const key = chunk.id ?? `call-${chunk.index ?? index}`
        if (!toolIndexes.has(key)) toolIndexes.set(key, nextToolIndex++)
        const position = toolIndexes.get(key)
        yield frame({
          tool_calls: [{
            index: position,
            ...(chunk.name ? { id: key, type: 'function', function: { name: chunk.name, arguments: '' } } : {}),
            ...(chunk.argumentsDelta ? { function: { arguments: chunk.argumentsDelta } } : {})
          }]
        })
        break
      }
      case 'usage':
        usage = chunk.usage
        break
      case 'finish': {
        yield frame({}, toFinishReason(chunk.reason))
        break
      }
      default:
        // block-start / block-end carry no wire meaning for a chat client.
        break
    }
    index += 1
  }

  if (meta.includeUsage && usage) {
    yield `data: ${JSON.stringify({
      id: meta.id,
      object: 'chat.completion.chunk',
      created: meta.created,
      model: meta.model,
      choices: [],
      usage: {
        prompt_tokens: usage.inputTokens ?? usage.promptTokens ?? 0,
        completion_tokens: usage.outputTokens ?? usage.completionTokens ?? 0,
        total_tokens: usage.totalTokens ?? 0
      }
    })}\n\n`
  }
  yield 'data: [DONE]\n\n'
}

/** Assemble a complete (non-streaming) OpenAI response from host chunks. */
export async function collectCompletion (chunks, meta) {
  let content = ''
  let reasoning = ''
  let finishReason = 'stop'
  let usage
  const toolCalls = []
  for await (const chunk of chunks) {
    switch (chunk?.type) {
      case 'text-delta': content += chunk.text ?? ''; break
      case 'reasoning-delta': reasoning += chunk.text ?? ''; break
      case 'tool-call-delta': {
        const existing = toolCalls.find((call) => call.id === chunk.id)
        if (existing) existing.function.arguments += chunk.argumentsDelta ?? ''
        else {
          toolCalls.push({
            id: chunk.id,
            type: 'function',
            function: { name: chunk.name ?? '', arguments: chunk.argumentsDelta ?? '' }
          })
        }
        break
      }
      case 'usage': usage = chunk.usage; break
      case 'finish': finishReason = toFinishReason(chunk.reason); break
      default: break
    }
  }
  const message = { role: 'assistant', content: content === '' && toolCalls.length > 0 ? null : content }
  if (reasoning !== '') message.reasoning_content = reasoning
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls
    finishReason = 'tool_calls'
  }
  return {
    id: meta.id,
    object: 'chat.completion',
    created: meta.created,
    model: meta.model,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    ...(usage ? {
      usage: {
        prompt_tokens: usage.inputTokens ?? usage.promptTokens ?? 0,
        completion_tokens: usage.outputTokens ?? usage.completionTokens ?? 0,
        total_tokens: usage.totalTokens ?? 0
      }
    } : {})
  }
}

/** The port and the auth token are irrelevant to a loopback caller. */
export function authorize () {
  return true
}

/** One id per request, in the shape OpenAI clients expect to echo. */
export function completionId () {
  return `chatcmpl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

const LOOPBACK = new Set(['::1', '127.0.0.1', '::ffff:127.0.0.1'])

/** True for the addresses the embedded app and a local CLI both come from. */
function isLoopback (address) {
  return address !== undefined && (LOOPBACK.has(address) || address.startsWith('127.'))
}

/**
 * Refuse a model-proxy request that did not come from this machine.
 *
 * This is the module's most important function: without it the endpoint is an open
 * relay to the user's paid model access for anything that can reach the port.
 */
export function isTrustedModelRequest (req) {
  if (req?.headers?.forwarded) return false
  if (req?.headers?.['x-forwarded-for']) return false
  return isLoopback(req?.socket?.remoteAddress)
}

export {
  DEFAULT_MODEL_ID,
  toFinishReason,
  isLoopback,
  Buffer
}

export { readJsonBody, writeJson, writeSseHead } from './http-util.js'