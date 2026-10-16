/**
 * Shared HTTP plumbing for the plugin's loopback routes.
 *
 * Split out of `http.js` so the model bridge can stream SSE without importing the
 * settings route table, and so request-body parsing and JSON writing exist once.
 */

import { Buffer } from 'node:buffer'

/** Send one JSON response. */
export function writeJson (res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  })
  res.end(body)
}

/** Open a Server-Sent Events response and return a writer for it. */
export function writeSseHead (res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    // A proxy between a CLI and loopback would otherwise buffer the whole stream
    // and defeat the point of streaming at all.
    'x-accel-buffering': 'no'
  })
  return {
    send (payload) {
      if (!res.writableEnded) res.write(payload)
    },
    end () {
      if (!res.writableEnded) res.end()
    }
  }
}

/**
 * Read one JSON request body.
 *
 * Returns `undefined` for malformed JSON so a caller can answer 400, and `{}` for
 * an empty body, which several CLI clients send on GET-like POSTs.
 */
export async function readJsonBody (req, maxBytes = 20_000_000) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > maxBytes) throw new Error(`request body exceeds ${maxBytes} bytes`)
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return undefined
  }
}

/** An OpenAI-shaped error envelope, which is what a client expects on failure. */
export function errorEnvelope (message, type = 'invalid_request_error', code) {
  return { error: { message, type, ...(code === undefined ? {} : { code }) } }
}