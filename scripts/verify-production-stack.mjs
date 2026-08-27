#!/usr/bin/env node

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const scratch = mkdtempSync(join(tmpdir(), 'tozalist-step91-runtime-'))
const envFile = join(scratch, 'runtime.env')
const imageTag = 'step91'
const syntheticValue = (...parts) => parts.join('-')
// The isolated verifier uses one MinIO root account for both separately named
// product and backup configurations. Production still requires distinct values.
const localObjectCredential = syntheticValue('synthetic', 'local', 'object', 'credential')
const values = {
  DOMAIN: 'preview.invalid',
  ACME_EMAIL: 'acme@preview.invalid',
  POSTGRES_USER: 'synthetic_user',
  POSTGRES_PASSWORD: syntheticValue('synthetic', 'postgres', 'password'),
  POSTGRES_DB: 'synthetic_preview',
  REDIS_PASSWORD: syntheticValue('synthetic', 'redis', 'password'),
  S3_ENDPOINT: 'http://minio:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'synthetic-product',
  S3_ACCESS_KEY: 'synthetic-access-key',
  S3_SECRET_KEY: localObjectCredential,
  BACKUP_S3_ENDPOINT: 'http://minio:9000',
  BACKUP_S3_REGION: 'us-east-1',
  BACKUP_S3_BUCKET: 'synthetic-backups',
  BACKUP_S3_PREFIX: 'database',
  BACKUP_S3_ACCESS_KEY: 'synthetic-access-key',
  BACKUP_S3_SECRET_KEY: localObjectCredential,
  SESSION_SECRET: syntheticValue('synthetic', 'session', 'value', 'thirty', 'two', 'characters'),
  METRICS_TOKEN: syntheticValue('synthetic', 'metrics', 'value', 'thirty', 'two', 'characters'),
  IMAGE_TAG: imageTag,
}
writeFileSync(
  envFile,
  Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n'),
)

const composeBase = [
  'compose',
  '--env-file',
  envFile,
  '-f',
  join(root, 'docker-compose.prod.yml'),
  '-f',
  join(root, 'deploy/docker-compose.verify.yml'),
]

function docker(args, options = {}) {
  return execFileSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  })
}

function compose(args, options = {}) {
  return docker([...composeBase, ...args], options)
}

function inspectImage(image, expectedUser, expectedPort) {
  const inspected = JSON.parse(docker(['image', 'inspect', image]))[0]
  assert.equal(inspected.Config.User, expectedUser, `${image} must run as ${expectedUser}`)
  assert(inspected.Config.Healthcheck?.Test?.length > 0, `${image} must define a health check`)
  assert.deepEqual(Object.keys(inspected.Config.ExposedPorts ?? {}), [expectedPort])
  docker(
    [
      'run',
      '--rm',
      '--entrypoint',
      '/bin/sh',
      image,
      '-c',
      "test -z \"$(find /app -type f \\( -name '*.test.*' -o -name '*.integration.test.*' -o -name '*.ts' \\) -print -quit 2>/dev/null)\" && ! find /app/node_modules/.pnpm -maxdepth 1 -name 'typescript@*' -print -quit 2>/dev/null | grep -q .",
    ],
    { stdio: 'pipe' },
  )
}

let succeeded = false
try {
  console.log('1/8 deterministic deployment checks')
  execFileSync('node', [join(root, 'scripts/deployment-verification.mjs')], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  })

  console.log('2/8 build all production images')
  compose(['build', 'api', 'worker', 'dashboard', 'web', 'engine', 'postgres-backup'], {
    stdio: 'inherit',
  })

  console.log('3/8 inspect final image users, health checks, ports, and artifacts')
  inspectImage(`tozalist-api:${imageTag}`, 'tozalist', '3001/tcp')
  inspectImage(`tozalist-worker:${imageTag}`, 'tozalist', '9464/tcp')
  inspectImage(`tozalist-dashboard:${imageTag}`, 'tozalist', '3002/tcp')
  inspectImage(`tozalist-web:${imageTag}`, 'tozalist', '3000/tcp')
  const engine = JSON.parse(docker(['image', 'inspect', `tozalist-engine:${imageTag}`]))[0]
  assert.equal(engine.Config.User, 'engine')
  assert.deepEqual(Object.keys(engine.Config.ExposedPorts ?? {}), ['8080/tcp'])
  const backup = JSON.parse(docker(['image', 'inspect', `tozalist-postgres-backup:${imageTag}`]))[0]
  assert.equal(backup.Config.User, 'postgres')
  assert(backup.Config.Healthcheck?.Test?.length > 0)

  console.log('4/8 start isolated synthetic production stack and wait for health')
  compose(['up', '-d', '--wait', '--wait-timeout', '300'], { stdio: 'inherit' })
  const psLines = compose(['ps', '--all', '--format', 'json'])
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  const unhealthy = psLines.filter(
    (entry) => entry.State === 'running' && !['', 'healthy'].includes(entry.Health ?? ''),
  )
  assert.deepEqual(unhealthy, [])

  console.log('5/8 seed an isolated synthetic key and run public smoke checks')
  const seedOutput = compose(['exec', '-T', 'api', 'node', 'packages/db/dist/seed.js'])
  const apiKey = seedOutput.match(/tzl_live_[A-Za-z0-9_-]+/)?.[0]
  assert(apiKey, 'seed did not emit the expected one-time API key')
  execFileSync(
    'node',
    [
      join(root, 'scripts/smoke-test.mjs'),
      '--web-url',
      'http://127.0.0.1',
      '--api-url',
      'http://127.0.0.1/api',
      '--dashboard-url',
      'http://127.0.0.1/dashboard',
      '--engine-url',
      // Do not probe 8080: the normal developer stack legitimately binds its
      // separate engine there. The runtime port assertions below prove that
      // the isolated production engine itself publishes no host port.
      'http://127.0.0.1:18080/health',
    ],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, SMOKE_API_KEY: apiKey, SMOKE_ALLOW_HTTP_LOCAL: 'true' },
    },
  )

  console.log('6/8 prove private networking and exact public port ownership')
  const ports = compose(['ps', '--format', 'json'])
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  for (const entry of ports) {
    const published = (entry.Publishers ?? [])
      .map((publisher) => Number(publisher.PublishedPort ?? 0))
      .filter((port) => port > 0)
    if (entry.Service === 'caddy') {
      assert.deepEqual(
        [...new Set(published)].sort((left, right) => left - right),
        [80, 443],
      )
    } else {
      assert.deepEqual(published, [])
    }
  }
  assert.throws(() =>
    compose(['exec', '-T', 'caddy', 'wget', '-T', '3', '-qO-', 'http://engine:8080/health']),
  )

  console.log('7/8 prove backup upload/retention and disposable restore')
  // The sidecar creates a startup backup to become healthy. Create another
  // explicitly after synthetic seeding/smoke so the restore must recover data.
  compose(['exec', '-T', 'postgres-backup', '/usr/local/bin/backup.sh'], { stdio: 'inherit' })
  const objects = compose([
    'exec',
    '-T',
    'postgres-backup',
    'aws',
    '--endpoint-url',
    'http://minio:9000',
    '--region',
    values.BACKUP_S3_REGION,
    's3api',
    'list-objects-v2',
    '--bucket',
    values.BACKUP_S3_BUCKET,
    '--prefix',
    `${values.BACKUP_S3_PREFIX}/daily/`,
    '--query',
    'Contents[].Key',
    '--output',
    'text',
  ])
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  assert(objects.length >= 1, 'backup sidecar did not upload a daily object')
  const backupFile = compose([
    'exec',
    '-T',
    'postgres-backup',
    '/bin/bash',
    '-c',
    "find /backups -maxdepth 1 -name 'tozalist-*.sql.gz' -type f | sort -r | head -n 1",
  ]).trim()
  assert(backupFile.startsWith('/backups/tozalist-'))
  const restoreTarget = 'synthetic_preview_restore_drill'
  compose(
    [
      'exec',
      '-T',
      '-e',
      `RESTORE_TARGET_DATABASE=${restoreTarget}`,
      '-e',
      `RESTORE_CONFIRMATION=restore-disposable:${restoreTarget}`,
      'postgres-backup',
      '/usr/local/bin/restore.sh',
      backupFile,
    ],
    { stdio: 'inherit' },
  )
  const proof = compose([
    'exec',
    '-T',
    'postgres',
    'psql',
    '--username',
    values.POSTGRES_USER,
    '--dbname',
    restoreTarget,
    '--tuples-only',
    '--command',
    'select count(*) from organizations',
  ]).trim()
  assert(Number(proof) >= 1)

  console.log('8/8 runtime verification complete')
  console.log(
    `Runtime evidence: ${psLines.length} services observed; ${objects.length} backup object(s); disposable restore query passed.`,
  )
  succeeded = true
} catch (error) {
  console.error(
    `Runtime deployment verification failed: ${error instanceof Error ? error.message : 'unknown error'}`,
  )
  try {
    compose(['ps', '--all'], { stdio: 'inherit' })
    compose(['logs', '--tail', '100'], { stdio: 'inherit' })
  } catch {
    // Preserve the primary failure; diagnostics are best effort and synthetic-only.
  }
  process.exitCode = 1
} finally {
  if (process.env.KEEP_STEP91_STACK !== 'true') {
    try {
      compose(['down', '--volumes', '--remove-orphans', '--timeout', '20'], { stdio: 'inherit' })
    } catch {
      if (succeeded) process.exitCode = 1
    }
  }
  rmSync(scratch, { recursive: true, force: true })
}
