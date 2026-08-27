#!/usr/bin/env node
/* global AbortSignal, Blob, FormData, fetch */

import { setTimeout as delay } from 'node:timers/promises'
import { URL } from 'node:url'

const SYNTHETIC_EMAIL = 'preview-check@synthetic.invalid'
const SYNTHETIC_BATCH =
  'email,name\npreview-one@synthetic.invalid,Synthetic One\npreview-two@synthetic.invalid,Synthetic Two\n'

function parseArgs(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || value === undefined) throw new Error('invalid arguments')
    values.set(name, value)
  }
  const required = ['--web-url', '--api-url', '--dashboard-url', '--engine-url']
  for (const name of required) {
    if (!values.has(name)) throw new Error(`missing ${name}`)
  }
  return Object.fromEntries(required.map((name) => [name.slice(2), values.get(name)]))
}

function normalizedBase(raw, allowLocalHttp) {
  const url = new URL(raw)
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(allowLocalHttp && loopback && url.protocol === 'http:')) {
    throw new Error(
      'public URLs must use HTTPS; HTTP is allowed only for an explicit loopback test',
    )
  }
  return url.toString().replace(/\/$/, '')
}

function endpoint(base, path) {
  return `${base}${path}`
}

async function request(url, options = {}) {
  return fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), ...options })
}

async function responseJson(response) {
  try {
    return await response.json()
  } catch {
    throw new Error(`expected JSON response, received status ${response.status}`)
  }
}

async function run(name, action) {
  await action()
  console.log(`PASS ${name}`)
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch {
    console.error(
      'Usage: SMOKE_API_KEY=<synthetic-key> pnpm smoke -- --web-url <url> --api-url <url> --dashboard-url <url> --engine-url <url>',
    )
    process.exit(2)
  }

  const apiKey = process.env.SMOKE_API_KEY
  if (apiKey === undefined || apiKey.trim() === '') {
    console.error('SMOKE_API_KEY is required and must contain a seeded synthetic-only key')
    process.exit(2)
  }

  const allowLocalHttp = process.env.SMOKE_ALLOW_HTTP_LOCAL === 'true'
  const web = normalizedBase(args['web-url'], allowLocalHttp)
  const api = normalizedBase(args['api-url'], allowLocalHttp)
  const dashboard = normalizedBase(args['dashboard-url'], allowLocalHttp)
  const engine = normalizedBase(args['engine-url'], allowLocalHttp)
  const auth = { authorization: `Bearer ${apiKey}` }

  await run('API health', async () => {
    const response = await request(endpoint(api, '/health'))
    if (response.status !== 200) throw new Error(`unexpected status ${response.status}`)
  })

  await run('invalid API key rejected', async () => {
    const response = await request(endpoint(api, '/v1/email/check'), {
      method: 'POST',
      headers: {
        authorization: 'Bearer invalid-synthetic-key',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email: SYNTHETIC_EMAIL, smtp: false }),
    })
    if (response.status !== 401) throw new Error(`unexpected status ${response.status}`)
  })

  await run('authenticated synthetic email check', async () => {
    const response = await request(endpoint(api, '/v1/email/check'), {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ email: SYNTHETIC_EMAIL, smtp: false }),
    })
    if (response.status !== 200) throw new Error(`unexpected status ${response.status}`)
    const envelope = await responseJson(response)
    if (typeof envelope?.data?.check_id !== 'string' || envelope?.meta?.smtp !== 'skipped') {
      throw new Error('email-check response contract mismatch')
    }
  })

  await run('synthetic batch round-trip', async () => {
    const form = new FormData()
    form.set('file', new Blob([SYNTHETIC_BATCH], { type: 'text/csv' }), 'synthetic-preview.csv')
    const created = await request(endpoint(api, '/v1/batches'), {
      method: 'POST',
      headers: auth,
      body: form,
    })
    if (created.status !== 200) throw new Error(`batch create status ${created.status}`)
    const createdEnvelope = await responseJson(created)
    const batchId = createdEnvelope?.data?.batch_id
    if (typeof batchId !== 'string' || createdEnvelope?.data?.status !== 'pending') {
      throw new Error('batch-create response contract mismatch')
    }

    for (let attempt = 0; attempt < 60; attempt += 1) {
      await delay(1_000)
      const response = await request(endpoint(api, `/v1/batches/${batchId}`), { headers: auth })
      if (response.status !== 200)
        throw new Error(`batch status request returned ${response.status}`)
      const envelope = await responseJson(response)
      const status = envelope?.data?.status
      if (status === 'done') return
      if (status === 'failed') throw new Error('synthetic batch reached failed state')
    }
    throw new Error('synthetic batch did not complete within 60 seconds')
  })

  for (const locale of ['en', 'uz', 'ru']) {
    await run(`public site ${locale}`, async () => {
      const response = await request(endpoint(web, `/${locale}`))
      if (response.status !== 200) throw new Error(`unexpected status ${response.status}`)
      if (!(response.headers.get('content-type') ?? '').includes('text/html')) {
        throw new Error('expected an HTML response')
      }
    })
  }

  await run('dashboard reachable', async () => {
    const response = await request(dashboard)
    if (response.status < 200 || response.status >= 400) {
      throw new Error(`unexpected status ${response.status}`)
    }
  })

  await run('engine has no public listener', async () => {
    try {
      const response = await request(engine)
      throw new Error(`engine probe received public HTTP status ${response.status}`)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('engine probe received')) throw error
    }
  })

  console.log('Smoke verification passed (synthetic fixtures only).')
}

main().catch((error) => {
  console.error(
    `Smoke verification failed: ${error instanceof Error ? error.message : 'unknown error'}`,
  )
  process.exit(1)
})
