/**
 * The `/v1` model routes: this app's model access, spoken in OpenAI's dialect.
 *
 * Codex is configured with a `base_url`; whatever sits behind that URL is the model
 * it uses. Pointing it here means Codex runs on the same provider and model as this
 * app, with no relay, no API key of its own, and no `codex login`.
 *
 * The routes are mounted on the host's `webServer` alongside the settings routes,
 * but they are the only part of this plugin meant for a non-browser caller, so they
 * carry their own trust check (`isTrustedModelRequest`) instead of the settings
 * guard: a model proxy reachable off-machine would hand a stranger the user's paid
 * model access.
 *
 * `llm.prepareCall` is used rather than `llm.stream` so the adapter is resolved once
 * and the resolved config is what gets validated by the host before dispatch —
 * `stream` on the service accepts a loose options object, while a prepared call
 * fails loudly when the request disagrees with what the adapter advertised.
 */

import process from 'node:process'

import {
  DEFAULT_MODEL_ID,
  collectCompletion,
  completionId,
  isTrustedModelRequest,
  toHostMessages,
  toHostTools,
  toOpenAiStream,
  toSystemPrompt
} from './model-bridge.js'
import { errorEnvelope, readJsonBody, writeJson, writeSseHead } from './http-util.js'

/** Route prefix a Codex `base_url` should end at, e.g. `http://127.0.0.1:3011/v1`. */
export const MODEL_BASE_PATH = '/v1'

/** Reasoning-effort ids the host understands, so a client value can be validated. */
const REASONING_EFFORTS = new Set(['minimal', 'low', 'medium', 'high'])

/**
 * Read the route a client asked Codex to use.
 *
 * A request may name any model; the plugin answers with the one this app is
 * configured for, and reports back the id it actually used. Silently substituting
 * without saying so would make a Codex run unexplainable, so the response always
 * carries the resolved id.
 */
function resolveTarget (llm, config, requested) {
  const provider = config.modelProvider || undefined
  const model = config.modelId || undefined
  if (provider && model) return { provider, model, requested }
  // No explicit setting: ask the host which routes exist and take the first, which
  // is the same route the app itself uses when nothing overrides it.
  const providers = typeof llm.listProviders === 'function' ? llm.listProviders() : []
  const first = Array.isArray(providers) ? providers[0] : undefined
  if (!first?.id) {
    throw new Error('no model provider is registered in this app, so the model bridge has nothing to route to')
  }
  return { provider: provider ?? first.id, model: model ?? requested ?? DEFAULT_MODEL_ID, requested }
}

/**
 * Mount the `/v1` model routes.
 *
 * @param {object} webCtx the injected `webServer` context
 * @param {object} deps
 * @param {Function} deps.llmProvider returns the live `llm` service, or undefined
 * @param {Function} deps.configProvider returns the live plugin config
 * @returns {() => void} disposer
 */
export function registerModelRoutes (webCtx, deps) {
  const disposers = []
  const add = (path, handler) => disposers.push(webCtx.webServer.register({ kind: 'exact', path, handler }))

  const llmOf = () => {
    const llm = deps.llmProvider?.()
    if (!llm) throw new Error('the host has no llm service mounted, so the model bridge cannot serve requests')
    return llm
  }

  const refuse = (res, status, message, type, code) => writeJson(res, status, errorEnvelope(message, type, code))

  /** Shared gate: loopback only, and only the two verbs OpenAI clients use. */
  const guard = (req, res, expect) => {
    if (!isTrustedModelRequest(req)) {
      refuse(res, 403, 'This endpoint only serves requests from this machine.', 'invalid_request_error', 'forbidden')
      return false
    }
    if (expect && req.method !== expect) {
      refuse(res, 405, `Method ${req.method} is not allowed here; use ${expect}.`, 'invalid_request_error', 'method_not_allowed')
      return false
    }
    return true
  }

  /**
   * Build the `llm.stream` options for one chat request.
   *
   * The host validates `provider/model/reasoningEffort/temperature/maxTokens/stop`
   * against the resolved adapter, so only fields the client actually sent are
   * forwarded — inventing a default here would surface as an
   * `UNSUPPORTED_REASONING_EFFORT` failure for a route that never offered it.
   */
  const buildOptions = (llm, config, body, signal) => {
    const target = resolveTarget(llm, config, body?.model)
    const reasoningEffort = typeof body?.reasoning_effort === 'string' && REASONING_EFFORTS.has(body.reasoning_effort)
      ? body.reasoning_effort
      : (config.reasoningEffort || undefined)
    const options = {
      provider: target.provider,
      model: target.model,
      messages: toHostMessages(body?.messages),
      purpose: 'model-bridge',
      signal
    }
    const system = toSystemPrompt(body?.messages)
    if (system !== undefined) options.system = system
    const tools = toHostTools(body?.tools)
    if (tools !== undefined) options.tools = tools
    if (reasoningEffort !== undefined) options.reasoningEffort = reasoningEffort
    if (typeof body?.temperature === 'number') options.temperature = body.temperature
    if (typeof body?.max_tokens === 'number' && body.max_tokens > 0) options.maxTokens = Math.floor(body.max_tokens)
    if (Array.isArray(body?.stop) && body.stop.length > 0) options.stop = body.stop.map(String)
    return { options, target }
  }

  /** `GET /v1/models` — what a client asks before it will talk to an endpoint. */
  add(`${MODEL_BASE_PATH}/models`, (req, res) => {
    if (!guard(req, res, 'GET')) return
    void (async () => {
      try {
        const llm = llmOf()
        const config = deps.configProvider?.() ?? {}
        const providers = typeof llm.listProviders === 'function' ? llm.listProviders() : []
        const data = []
        for (const provider of Array.isArray(providers) ? providers : []) {
          let models = []
          try {
            models = await llm.listModels(provider.id)
          } catch {
            // A provider whose catalogue is unreachable still deserves to be listed
            // by the model the plugin would route to, so the client can proceed.
            models = []
          }
          for (const model of Array.isArray(models) ? models : []) {
            data.push({
              id: String(model?.id ?? model?.name ?? provider.id),
              object: 'model',
              created: 0,
              owned_by: provider.id
            })
          }
        }
        if (data.length === 0) {
          // Never answer with an empty catalogue: many clients treat that as "no
          // usable model" and refuse to send a completion at all.
          data.push({ id: config.modelId || DEFAULT_MODEL_ID, object: 'model', created: 0, owned_by: config.modelProvider || 'dsh' })
        }
        writeJson(res, 200, { object: 'list', data })
      } catch (error) {
        refuse(res, 500, error instanceof Error ? error.message : String(error), 'api_error')
      }
    })()
  })

  /** `POST /v1/chat/completions` — streaming and non-streaming. */
  add(`${MODEL_BASE_PATH}/chat/completions`, (req, res) => {
    if (!guard(req, res, 'POST')) return
    void (async () => {
      // One controller for the whole request so a client disconnect actually stops
      // the upstream model call instead of leaving it running to completion.
      const controller = new AbortController()
      const onClose = () => controller.abort()
      res.on?.('close', onClose)
      try {
        const body = await readJsonBody(req)
        if (body === undefined) {
          refuse(res, 400, 'Request body must be valid JSON.', 'invalid_request_error', 'invalid_json')
          return
        }
        if (!Array.isArray(body?.messages) || body.messages.length === 0) {
          refuse(res, 400, 'messages must be a non-empty array.', 'invalid_request_error', 'missing_messages')
          return
        }
        const llm = llmOf()
        const config = deps.configProvider?.() ?? {}
        const { options, target } = buildOptions(llm, config, body, controller.signal)
        const meta = {
          id: completionId(),
          model: target.model,
          created: Math.floor(Date.now() / 1000),
          includeUsage: body?.stream_options?.include_usage === true
        }

        const prepared = await llm.prepareCall({
          provider: options.provider,
          model: options.model,
          ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }),
          ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
          ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
          ...(options.stop === undefined ? {} : { stop: options.stop })
        }, controller.signal)

        const stream = prepared.stream({ ...options, config: prepared.config })

        if (body?.stream === true) {
          const sse = writeSseHead(res)
          for await (const payload of toOpenAiStream(stream, meta)) sse.send(payload)
          sse.end()
          return
        }
        writeJson(res, 200, await collectCompletion(stream, meta))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // Headers may already be sent once a stream starts; falling back to a JSON
        // error then would corrupt the SSE body, so only write when still open.
        if (!res.headersSent) refuse(res, 500, message, 'api_error', error?.code)
      } finally {
        res.off?.('close', onClose)
        if (!res.writableEnded) res.end()
      }
    })()
  })

  // A `GET /v1` probe is common; answering it keeps a client's connection check
  // from reading as a broken endpoint.
  add(MODEL_BASE_PATH, (req, res) => {
    if (!guard(req, res, 'GET')) return
    const config = deps.configProvider?.() ?? {}
    writeJson(res, 200, {
      object: 'list',
      data: [{ id: config.modelId || DEFAULT_MODEL_ID, object: 'model', created: 0, owned_by: config.modelProvider || 'dsh' }]
    })
  })

  webCtx.effect(() => () => {
    while (disposers.length > 0) {
      const dispose = disposers.pop()
      try {
        dispose()
      } catch {
        // A disposer that throws must not strand the ones still queued.
      }
    }
  }, 'dsh-localcoding-mcp: model routes')

  return () => {
    while (disposers.length > 0) {
      const dispose = disposers.pop()
      try {
        dispose()
      } catch {
        // keep unwinding
      }
    }
  }
}

/** Where a caller should point a `base_url`, given the host's GUI port. */
export function modelBaseUrl (baseUrl) {
  const trimmed = String(baseUrl ?? '').replace(/\/+$/, '')
  return `${trimmed}${MODEL_BASE_PATH}`
}

export { process }