import { isIP } from 'node:net'
// undici's own fetch is required: Node's global fetch refuses dispatchers
// constructed from the installed undici package (UND_ERR_INVALID_ARG).
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from 'undici'

/**
 * The HTTP seam for webhook delivery.
 *
 * The default transport PINS the outbound socket to the address the SSRF
 * check approved: a custom DNS `lookup` hands the connector exactly that
 * address, so no fresh - and potentially re-pointed - resolution can happen
 * between the check and the connection. The URL keeps the original hostname,
 * which therefore still drives TLS certificate validation, SNI, and the Host
 * header. Certificate verification stays on; redirects are never followed;
 * the timeout is hard.
 */

export type WebhookPostRequest = {
  url: string
  /** The exact raw body that was signed. */
  body: string
  headers: Record<string, string>
  timeoutMs: number
  /** The SSRF-approved address the socket MUST connect to. */
  connectToAddress: string
}

export type WebhookPostResult =
  | { kind: 'response'; statusCode: number }
  | { kind: 'redirect'; statusCode: number }
  | { kind: 'timeout' }
  | { kind: 'network_error' }

export type WebhookTransport = (request: WebhookPostRequest) => Promise<WebhookPostResult>

export const fetchWebhookTransport: WebhookTransport = async (request) => {
  const family = isIP(request.connectToAddress)
  if (family === 0) return { kind: 'network_error' }

  // Every name resolves to the single approved address - nothing else.
  const dispatcher = new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        if (options.all === true) {
          callback(null, [{ address: request.connectToAddress, family }])
        } else {
          // Compatibility with lookup callers expecting (err, address, family).
          ;(callback as unknown as (e: null, a: string, f: number) => void)(
            null,
            request.connectToAddress,
            family,
          )
        }
      },
    },
  })

  let response: UndiciResponse
  try {
    response = await undiciFetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      // Redirects are refused, not followed: a 3xx could bounce the signed
      // payload to an attacker-chosen (possibly internal) destination.
      redirect: 'manual',
      signal: AbortSignal.timeout(request.timeoutMs),
      // Routes this request through the pinning agent above.
      dispatcher,
    })
  } catch (error) {
    await dispatcher.close().catch(() => undefined)
    if (
      error instanceof DOMException &&
      (error.name === 'TimeoutError' || error.name === 'AbortError')
    ) {
      return { kind: 'timeout' }
    }
    return { kind: 'network_error' }
  }

  const result: WebhookPostResult =
    response.status >= 300 && response.status < 400
      ? { kind: 'redirect', statusCode: response.status }
      : { kind: 'response', statusCode: response.status }
  // Drain/discard the body so the connection is reusable before closing.
  await response.arrayBuffer().catch(() => undefined)
  await dispatcher.close().catch(() => undefined)
  return result
}
