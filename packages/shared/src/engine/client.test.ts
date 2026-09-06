import { describe, expect, it } from 'vitest'
import { CircuitBreaker } from './circuit-breaker.js'
import {
  EngineContractError,
  EngineHttpError,
  EngineTimeoutError,
  EngineUnavailableError,
} from './errors.js'
import { EngineClient, type EngineTransportRequest } from './client.js'
import type { EngineResponse } from './schema.js'

// --- test harness -----------------------------------------------------------

function validResponse(overrides: Partial<EngineResponse> = {}): EngineResponse {
  return {
    email: 'user@example.com',
    syntax: { valid: true, username: 'user', domain: 'example.com' },
    mx: { has_mx: true, records: ['mx.example.com.'], error: '' },
    disposable: false,
    role_account: false,
    free_provider: false,
    smtp: null,
    duration_ms: 3,
    ...overrides,
  }
}

type Step =
  | { kind: 'ok'; body?: unknown }
  | { kind: 'status'; status: number }
  | { kind: 'network' }
  | { kind: 'timeout' }

type CapturedLog = { event: string; fields: Record<string, string | number | boolean> }

/** A scripted client: transport, clock, delay and logger all captured. */
function makeClient(
  steps: Step[],
  options: { breaker?: { failureThreshold?: number; openDurationMs?: number } } = {},
) {
  let nowMs = 1_000_000
  const requests: EngineTransportRequest[] = []
  const delays: number[] = []
  const logs: CapturedLog[] = []
  let cursor = 0

  const client = new EngineClient({
    baseUrl: 'http://engine.internal:8080',
    clock: () => nowMs,
    delay: (ms) => {
      delays.push(ms)
      return Promise.resolve()
    },
    logger: {
      info: (event, fields) => {
        logs.push({ event, fields })
      },
    },
    transport: (request) => {
      requests.push(request)
      const step = steps[cursor] ?? steps[steps.length - 1]
      cursor += 1
      switch (step?.kind) {
        case 'ok':
          return Promise.resolve({
            status: 200,
            body: JSON.stringify(step.body ?? validResponse()),
          })
        case 'status':
          return Promise.resolve({ status: step.status, body: '{}' })
        case 'network':
          return Promise.reject(new TypeError('fetch failed: connection refused'))
        case 'timeout':
          return Promise.reject(new EngineTimeoutError(request.timeoutMs))
        default:
          throw new Error('script exhausted')
      }
    },
    ...(options.breaker ? { breaker: options.breaker } : {}),
  })

  return {
    client,
    requests,
    delays,
    logs,
    advance: (ms: number) => {
      nowMs += ms
    },
  }
}

const OPTS = { smtp: false, catchAll: false }

// --- 1. success + validation ------------------------------------------------

describe('EngineClient success path', () => {
  it('POSTs the exact contract body to /verify and returns the validated response', async () => {
    const { client, requests } = makeClient([{ kind: 'ok' }])

    const result = await client.verify('user@example.com', { smtp: false, catchAll: false })

    expect(result).toEqual(validResponse())
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('http://engine.internal:8080/verify')
    expect(JSON.parse(requests[0]?.body ?? '')).toEqual({
      email: 'user@example.com',
      smtp: false,
      catch_all: false,
    })
  })

  it('never places the email in the URL', async () => {
    const { client, requests } = makeClient([{ kind: 'ok' }])
    await client.verify('user@example.com', OPTS)
    expect(requests[0]?.url).not.toContain('user')
    expect(requests[0]?.url).not.toContain('%40')
  })

  it('maps smtp and catchAll options into the body and picks the SMTP timeout', async () => {
    const body = validResponse({
      smtp: {
        attempted: true,
        mailbox_accepted: true,
        catch_all: false,
        full_inbox: false,
        disabled: false,
        error: '',
      },
    })
    const { client, requests } = makeClient([{ kind: 'ok', body }])

    await client.verify('user@example.com', { smtp: true, catchAll: true })

    expect(JSON.parse(requests[0]?.body ?? '')).toMatchObject({ smtp: true, catch_all: true })
    expect(requests[0]?.timeoutMs).toBe(30_000)
  })

  it('uses the 20 second timeout for non-SMTP requests', async () => {
    const { client, requests } = makeClient([{ kind: 'ok' }])
    await client.verify('user@example.com', OPTS)
    expect(requests[0]?.timeoutMs).toBe(20_000)
  })
})

// --- 2-4. contract drift ----------------------------------------------------

describe('EngineClient contract validation', () => {
  it('rejects a response missing a field', async () => {
    const { email: _dropped, ...missingEmail } = validResponse()
    const { client } = makeClient([{ kind: 'ok', body: missingEmail }])

    await expect(client.verify('user@example.com', OPTS)).rejects.toBeInstanceOf(
      EngineContractError,
    )
  })

  it('rejects a response with an unexpected field', async () => {
    const { client } = makeClient([{ kind: 'ok', body: { ...validResponse(), reachable: 'yes' } }])

    await expect(client.verify('user@example.com', OPTS)).rejects.toBeInstanceOf(
      EngineContractError,
    )
  })

  it('rejects has_mx with an invalid type', async () => {
    const drifted = validResponse()
    const body = { ...drifted, mx: { ...drifted.mx, has_mx: 'yes' } }
    const { client } = makeClient([{ kind: 'ok', body }])

    await expect(client.verify('user@example.com', OPTS)).rejects.toBeInstanceOf(
      EngineContractError,
    )
  })

  it('accepts has_mx null (failed lookup) as contract-legal', async () => {
    const body = validResponse({ mx: { has_mx: null, records: [], error: 'dns timeout' } })
    const { client } = makeClient([{ kind: 'ok', body }])

    const result = await client.verify('user@example.com', OPTS)
    expect(result.mx.has_mx).toBeNull()
  })

  it('rejects a non-JSON body', async () => {
    const { client } = makeClient([])
    // Direct transport script: 200 with garbage.
    const garbage = new EngineClient({
      baseUrl: 'http://engine.internal:8080',
      clock: () => 0,
      delay: () => Promise.resolve(),
      logger: { info: () => {} },
      transport: () => Promise.resolve({ status: 200, body: 'not json' }),
    })
    await expect(garbage.verify('user@example.com', OPTS)).rejects.toBeInstanceOf(
      EngineContractError,
    )
    void client
  })

  it('contract errors never include the email address', async () => {
    const { client } = makeClient([{ kind: 'ok', body: { ...validResponse(), extra: 1 } }])
    const error = await client.verify('user@example.com', OPTS).catch((e: Error) => e)
    expect((error as Error).message).not.toContain('user@example.com')
    expect((error as Error).message).not.toContain('user')
  })
})

// --- 5-9. retries -----------------------------------------------------------

describe('EngineClient retries', () => {
  it('retries network failures with exactly 200ms then 800ms delays', async () => {
    const { client, delays, requests } = makeClient([
      { kind: 'network' },
      { kind: 'network' },
      { kind: 'ok' },
    ])

    const result = await client.verify('user@example.com', OPTS)

    expect(result.email).toBe('user@example.com')
    expect(requests).toHaveLength(3)
    expect(delays).toEqual([200, 800])
  })

  it('gives up after 3 attempts of network failure with EngineUnavailableError', async () => {
    const { client, requests, delays } = makeClient([
      { kind: 'network' },
      { kind: 'network' },
      { kind: 'network' },
    ])

    await expect(client.verify('user@example.com', OPTS)).rejects.toBeInstanceOf(
      EngineUnavailableError,
    )
    expect(requests).toHaveLength(3)
    expect(delays).toEqual([200, 800])
  })

  it('retries HTTP 5xx and can succeed', async () => {
    const { client, requests } = makeClient([{ kind: 'status', status: 503 }, { kind: 'ok' }])

    await client.verify('user@example.com', OPTS)
    expect(requests).toHaveLength(2)
  })

  it('exhausted 5xx retries surface EngineHttpError with the status', async () => {
    const { client, requests } = makeClient([
      { kind: 'status', status: 500 },
      { kind: 'status', status: 502 },
      { kind: 'status', status: 503 },
    ])

    const error = await client.verify('user@example.com', OPTS).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EngineHttpError)
    expect((error as EngineHttpError).status).toBe(503)
    expect(requests).toHaveLength(3)
  })

  it('never retries HTTP 4xx', async () => {
    const { client, requests, delays } = makeClient([
      { kind: 'status', status: 400 },
      { kind: 'ok' },
    ])

    const error = await client.verify('user@example.com', OPTS).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(EngineHttpError)
    expect((error as EngineHttpError).status).toBe(400)
    expect(requests).toHaveLength(1)
    expect(delays).toEqual([])
  })

  it('never retries a timeout when smtp=true', async () => {
    const { client, requests, delays } = makeClient([{ kind: 'timeout' }, { kind: 'ok' }])

    await expect(
      client.verify('user@example.com', { smtp: true, catchAll: false }),
    ).rejects.toBeInstanceOf(EngineTimeoutError)
    expect(requests).toHaveLength(1)
    expect(delays).toEqual([])
  })

  it('never retries a non-SMTP timeout either: the engine deadline already passed', async () => {
    const { client, requests, delays } = makeClient([{ kind: 'timeout' }, { kind: 'ok' }])

    await expect(client.verify('user@example.com', OPTS)).rejects.toBeInstanceOf(EngineTimeoutError)
    expect(requests).toHaveLength(1)
    expect(delays).toEqual([])
  })

  it('does not retry contract drift', async () => {
    const { client, requests } = makeClient([
      { kind: 'ok', body: { broken: true } },
      { kind: 'ok' },
    ])

    await expect(client.verify('user@example.com', OPTS)).rejects.toBeInstanceOf(
      EngineContractError,
    )
    expect(requests).toHaveLength(1)
  })
})

// --- 10-14. circuit breaker through the client ------------------------------

describe('EngineClient circuit breaker', () => {
  // Threshold 5 with retries makes scripts long; each failed CALL is one
  // eligible failure however many attempts it burned.
  it('opens after 5 consecutive eligible failed calls and stops making requests', async () => {
    const { client, requests } = makeClient(
      Array.from({ length: 15 }, () => ({ kind: 'network' }) as Step),
    )

    for (let call = 0; call < 5; call++) {
      await expect(client.verify('user@example.com', OPTS)).rejects.toBeInstanceOf(
        EngineUnavailableError,
      )
    }
    const requestsBeforeOpen = requests.length
    expect(requestsBeforeOpen).toBe(15) // 5 calls x 3 attempts

    // 11. Open circuit: immediate failure, zero HTTP requests.
    await expect(client.verify('user@example.com', OPTS)).rejects.toBeInstanceOf(
      EngineUnavailableError,
    )
    expect(requests.length).toBe(requestsBeforeOpen)
  })

  it('half-open admits exactly one probe; success closes the circuit', async () => {
    const steps: Step[] = [
      ...Array.from({ length: 15 }, () => ({ kind: 'network' }) as Step),
      { kind: 'ok' },
      { kind: 'ok' },
    ]
    const { client, requests, advance } = makeClient(steps)

    for (let call = 0; call < 5; call++) {
      await client.verify('user@example.com', OPTS).catch(() => undefined)
    }
    expect(requests.length).toBe(15)

    advance(30_000)

    // 12+13. One probe runs, succeeds, circuit closes; next call flows freely.
    await client.verify('user@example.com', OPTS)
    expect(requests.length).toBe(16)
    await client.verify('user@example.com', OPTS)
    expect(requests.length).toBe(17)
  })

  it('concurrent calls during the half-open probe fail immediately', async () => {
    let releaseProbe: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseProbe = resolve
    })
    let calls = 0
    let nowMs = 0

    const client = new EngineClient({
      baseUrl: 'http://engine.internal:8080',
      clock: () => nowMs,
      delay: () => Promise.resolve(),
      logger: { info: () => {} },
      breaker: { failureThreshold: 1 },
      transport: async () => {
        calls += 1
        // The first verify call burns 3 attempts; all must fail to open the circuit.
        if (calls <= 3) throw new TypeError('down')
        await gate
        return { status: 200, body: JSON.stringify(validResponse()) }
      },
    })

    // Open the circuit (threshold 1; network failure retries 3 attempts = calls 1..3).
    await expect(client.verify('user@example.com', OPTS)).rejects.toBeInstanceOf(
      EngineUnavailableError,
    )

    nowMs += 30_000
    const probe = client.verify('user@example.com', OPTS)
    // Give the probe a tick to enter the transport before racing it.
    await Promise.resolve()

    await expect(client.verify('user@example.com', OPTS)).rejects.toBeInstanceOf(
      EngineUnavailableError,
    )

    releaseProbe?.()
    await expect(probe).resolves.toMatchObject({ email: 'user@example.com' })
  })

  it('a failed half-open probe reopens the circuit for another 30 seconds', async () => {
    const steps: Step[] = Array.from({ length: 40 }, () => ({ kind: 'network' }) as Step)
    const { client, requests, advance } = makeClient(steps, {
      breaker: { failureThreshold: 1 },
    })

    await client.verify('user@example.com', OPTS).catch(() => undefined)
    const afterOpen = requests.length // 3 attempts

    advance(30_000)
    // 14. The probe fails -> circuit reopens without waiting for a threshold.
    await expect(client.verify('user@example.com', OPTS)).rejects.toBeInstanceOf(
      EngineUnavailableError,
    )
    const afterProbe = requests.length
    expect(afterProbe).toBeGreaterThan(afterOpen)

    // Still open: no request happens.
    await expect(client.verify('user@example.com', OPTS)).rejects.toBeInstanceOf(
      EngineUnavailableError,
    )
    expect(requests.length).toBe(afterProbe)

    // And after another cool-down a new probe is admitted.
    advance(30_000)
    await client.verify('user@example.com', OPTS).catch(() => undefined)
    expect(requests.length).toBeGreaterThan(afterProbe)
  })

  it('HTTP 4xx neither counts toward opening nor resets the failure streak', async () => {
    const steps: Step[] = [
      { kind: 'network' },
      { kind: 'network' },
      { kind: 'network' }, // call 1: failure 1
      { kind: 'status', status: 400 }, // call 2: neutral
      { kind: 'network' },
      { kind: 'network' },
      { kind: 'network' }, // call 3: failure 2 -> threshold 2 reached -> open
      { kind: 'ok' },
    ]
    const { client, requests } = makeClient(steps, { breaker: { failureThreshold: 2 } })

    await client.verify('user@example.com', OPTS).catch(() => undefined)
    await client.verify('user@example.com', OPTS).catch(() => undefined)
    await client.verify('user@example.com', OPTS).catch(() => undefined)

    const requestsSoFar = requests.length // 3 + 1 + 3
    await expect(client.verify('user@example.com', OPTS)).rejects.toBeInstanceOf(
      EngineUnavailableError,
    )
    expect(requests.length).toBe(requestsSoFar)
  })
})

// --- 15. privacy ------------------------------------------------------------

describe('EngineClient logging', () => {
  it('emits one structured event with domain, hash, duration, outcome, attempts', async () => {
    const { client, logs } = makeClient([{ kind: 'network' }, { kind: 'ok' }])

    await client.verify('Secret.Person@Example.com', OPTS)

    expect(logs).toHaveLength(1)
    const entry = logs[0]
    expect(entry?.event).toBe('engine_verify')
    expect(entry?.fields).toMatchObject({
      domain: 'Example.com',
      outcome: 'ok',
      attempts: 2,
    })
    expect(typeof entry?.fields.duration_ms).toBe('number')
    expect(String(entry?.fields.local_hash)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('never logs the full email or raw local part on any outcome', async () => {
    const email = 'Very.Secret.Person@example.test'
    const scripts: Step[][] = [
      [{ kind: 'ok' }],
      [{ kind: 'status', status: 400 }],
      [
        { kind: 'status', status: 500 },
        { kind: 'status', status: 500 },
        { kind: 'status', status: 500 },
      ],
      [{ kind: 'network' }, { kind: 'network' }, { kind: 'network' }],
      [{ kind: 'timeout' }, { kind: 'timeout' }, { kind: 'timeout' }],
      [{ kind: 'ok', body: { drift: true } }],
    ]

    for (const steps of scripts) {
      const { client, logs } = makeClient(steps)
      await client.verify(email, OPTS).catch(() => undefined)

      const raw = JSON.stringify(logs)
      expect(logs.length).toBe(1)
      expect(raw).not.toContain(email)
      expect(raw).not.toContain('Very.Secret.Person')
      expect(raw).toContain('example.test')
    }
  })

  it('regression: a transport error message containing an email never leaks', async () => {
    const email = 'Secret.Person@example.test'
    const logs: CapturedLog[] = []

    const client = new EngineClient({
      baseUrl: 'http://engine.internal:8080',
      clock: () => 0,
      delay: () => Promise.resolve(),
      logger: {
        info: (event, fields) => {
          logs.push({ event, fields })
        },
      },
      // A hostile-ish runtime that echoes the request body into the error.
      transport: () =>
        Promise.reject(
          new Error(`connect ECONNREFUSED while sending {"email":"${email}"} to /verify`),
        ),
    })

    const error = await client.verify(email, OPTS).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(EngineUnavailableError)
    const message = (error as Error).message
    expect(message).toBe('engine request failed')
    expect(message).not.toContain(email)
    expect(message).not.toContain('Secret.Person')

    const rawLogs = JSON.stringify(logs)
    expect(rawLogs).not.toContain(email)
    expect(rawLogs).not.toContain('Secret.Person')
    expect(logs[0]?.fields).toMatchObject({ outcome: 'network_error', attempts: 3 })
  })

  it('logs circuit_open with zero attempts and no request body anywhere', async () => {
    const { client, logs } = makeClient(
      Array.from({ length: 15 }, () => ({ kind: 'network' }) as Step),
    )
    for (let call = 0; call < 5; call++) {
      await client.verify('user@example.com', OPTS).catch(() => undefined)
    }
    logs.length = 0

    await client.verify('user@example.com', OPTS).catch(() => undefined)
    expect(logs).toHaveLength(1)
    expect(logs[0]?.fields).toMatchObject({ outcome: 'circuit_open', attempts: 0 })
  })
})

// --- breaker unit tests with injected clock ---------------------------------

describe('CircuitBreaker (unit)', () => {
  function makeBreaker(threshold = 5) {
    let nowMs = 0
    const breaker = new CircuitBreaker({ clock: () => nowMs, failureThreshold: threshold })
    return { breaker, advance: (ms: number) => (nowMs += ms) }
  }

  it('closed circuit resets its streak on success', () => {
    const { breaker } = makeBreaker(2)
    breaker.acquire()
    breaker.recordFailure()
    breaker.acquire()
    breaker.recordSuccess()
    breaker.acquire()
    breaker.recordFailure()
    // Only one consecutive failure - still closed.
    expect(() => breaker.acquire()).not.toThrow()
  })

  it('stays open for the full 30 seconds', () => {
    const { breaker, advance } = makeBreaker(1)
    breaker.acquire()
    breaker.recordFailure()
    advance(29_999)
    expect(() => breaker.acquire()).toThrow(EngineUnavailableError)
    advance(1)
    expect(() => breaker.acquire()).not.toThrow()
  })

  it('a 4xx probe outcome closes the circuit (the engine answered)', () => {
    const { breaker, advance } = makeBreaker(1)
    breaker.acquire()
    breaker.recordFailure()
    advance(30_000)
    breaker.acquire() // half-open probe
    breaker.recordNeutral()
    expect(() => breaker.acquire()).not.toThrow()
  })
})
