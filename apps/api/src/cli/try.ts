import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createApiKeyForOrg, createClient, revokeApiKeyById } from '@tozalist/db'
import { loadWorkspaceEnv } from '@tozalist/shared'

/**
 * pnpm try — a one-input local page for checking an email address.
 *
 * Local development only. It mints a temporary API key for the seeded demo
 * organisation, keeps it in this process, and proxies the browser's requests
 * to the running API so the key never reaches the page. The key is revoked
 * when you stop the process with Ctrl+C.
 *
 * Needs `docker compose up -d`, `pnpm db:seed` (once), and `pnpm dev` (or at
 * least the API) running.
 */

loadWorkspaceEnv()

const DEMO_ORG_ID = '00000000-0000-4000-8000-000000000001'
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? `http://localhost:${process.env.API_PORT ?? '3001'}`
const PORT = Number(process.env.TRY_PORT ?? '3005')
/** How long to wait for the background SMTP probe before showing the offline verdict. */
const PROBE_WAIT_MS = 45_000

type CheckResponse = {
  data?: { check_id?: string }
  meta?: { smtp?: 'skipped' | 'pending' | 'complete' }
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TozaList — try a check</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8fafc;
         font: 16px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #0f172a; }
  main { width: min(520px, 92vw); background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; }
  h1 { margin: 0 0 16px; font-size: 22px; }
  form { display: flex; gap: 8px; }
  input { flex: 1; font: inherit; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; }
  button { font: inherit; padding: 10px 16px; border: 0; border-radius: 8px; background: #0f172a; color: #fff; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: wait; }
  #out { margin-top: 20px; display: none; }
  .verdict { display: inline-block; padding: 6px 14px; border-radius: 999px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
  .valid   { background: #dcfce7; color: #166534; }
  .risky   { background: #fef3c7; color: #92400e; }
  .unknown { background: #e2e8f0; color: #334155; }
  .invalid { background: #fee2e2; color: #991b1b; }
  .note { margin: 10px 0 0; color: #475569; }
  ul { margin: 12px 0 0; padding-left: 18px; }
  li { margin: 4px 0; }
  code { background: #f1f5f9; padding: 1px 6px; border-radius: 4px; font-size: 14px; }
  .disclaimer { margin-top: 16px; font-size: 13px; color: #64748b; }
  .error { color: #b91c1c; }
</style>
</head>
<body>
<main>
  <h1>Check an email address</h1>
  <form id="f">
    <input id="email" type="text" placeholder="someone@example.com" autofocus autocomplete="off" spellcheck="false">
    <button id="go" type="submit">Check</button>
  </form>
  <div id="out"></div>
</main>
<script>
  const f = document.getElementById('f'), out = document.getElementById('out'), go = document.getElementById('go')
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))
  f.addEventListener('submit', async (e) => {
    e.preventDefault()
    const email = document.getElementById('email').value.trim()
    if (!email) return
    go.disabled = true; out.style.display = 'block'; out.innerHTML = '<p class="note">Checking… (a mailbox probe can take up to ~30 s)</p>'
    try {
      const r = await fetch('/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) })
      const j = await r.json()
      if (j.error) { out.innerHTML = '<p class="error">' + esc(j.error.code) + ': ' + esc(j.error.message) + '</p>'; return }
      const d = j.data
      let html = '<span class="verdict ' + esc(d.verdict) + '">' + esc(d.verdict) + '</span>'
      if (d.verdict === 'unknown') html += '<p class="note">Do not delete — we could not determine this address.</p>'
      const smtp = (j.meta || {}).smtp
      if (smtp === 'complete') html += '<p class="note">Mailbox probed over SMTP.</p>'
      else if (smtp === 'pending') html += '<p class="note">Mailbox probe still running; showing the offline result.</p>'
      else if (smtp === 'skipped') html += '<p class="note">Mailbox not probed (SMTP_ENABLED is false, or the organisation has it off).</p>'
      if (d.suggestion) html += '<p class="note">Did you mean <code>' + esc(d.suggestion) + '</code>?</p>'
      html += '<ul>' + (d.reason_codes || []).map((c) => '<li><code>' + esc(c) + '</code> ' + esc((d.reason_explanations || {})[c] || '') + '</li>').join('') + '</ul>'
      html += '<p class="disclaimer">' + esc(d.disclaimer || '') + '</p>'
      out.innerHTML = html
    } catch (err) {
      out.innerHTML = '<p class="error">Could not reach the local API. Is <code>pnpm dev</code> running?</p>'
    } finally { go.disabled = false }
  })
</script>
</body>
</html>
`

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      data += chunk
      if (data.length > 10_000) reject(new Error('body too large'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

async function main(): Promise<void> {
  const { db, sql } = createClient({ maxConnections: 1 })
  const minted = await createApiKeyForOrg(db, DEMO_ORG_ID, 'local try page (temporary)')
  if (!minted.ok) {
    console.error('The demo organisation is missing. Run `pnpm db:seed` once, then retry.')
    await sql.end()
    process.exit(1)
  }
  const apiKey = minted.created.plaintext
  const apiKeyId = minted.created.apiKeyId

  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        return send(res, 200, 'text/html; charset=utf-8', PAGE)
      }
      if (req.method === 'POST' && req.url === '/check') {
        const body = JSON.parse(await readBody(req)) as { email?: unknown }
        const email = typeof body.email === 'string' ? body.email : ''
        const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }
        // Ask for the mailbox probe. The API answers immediately with the offline
        // verdict and meta.smtp = "pending"; the worker probes in the background,
        // so poll the check until it is complete (or give up and show what we have).
        const upstream = await fetch(`${API_URL}/v1/email/check`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ email, smtp: true }),
        })
        let text = await upstream.text()
        if (upstream.ok) {
          let parsed = JSON.parse(text) as CheckResponse
          const deadline = Date.now() + PROBE_WAIT_MS
          while (
            parsed.meta?.smtp === 'pending' &&
            parsed.data?.check_id &&
            Date.now() < deadline
          ) {
            await new Promise((resolve) => setTimeout(resolve, 1_000))
            const poll = await fetch(`${API_URL}/v1/email/check/${parsed.data.check_id}`, {
              headers,
            })
            if (!poll.ok) break
            text = await poll.text()
            parsed = JSON.parse(text) as CheckResponse
          }
        }
        return send(res, upstream.status, 'application/json; charset=utf-8', text)
      }
      return send(res, 404, 'text/plain; charset=utf-8', 'not found')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'request failed'
      return send(
        res,
        502,
        'application/json; charset=utf-8',
        JSON.stringify({ error: { code: 'TRY_PAGE', message } }),
      )
    }
  })

  let closing = false
  const shutdown = async (): Promise<void> => {
    if (closing) return
    closing = true
    server.close()
    await revokeApiKeyById(db, apiKeyId).catch(() => undefined)
    await sql.end().catch(() => undefined)
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`TozaList try page: http://localhost:${PORT}  (API: ${API_URL})`)
    console.log(
      'Temporary API key minted for the demo organisation; it is revoked when you press Ctrl+C.',
    )
  })
}

void main()
