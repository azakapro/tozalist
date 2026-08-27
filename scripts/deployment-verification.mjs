#!/usr/bin/env node

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const scratch = mkdtempSync(join(tmpdir(), 'tozalist-deploy-verify-'))
const safeEnv = join(scratch, 'safe.env')
const composeFile = join(root, 'docker-compose.prod.yml')
const syntheticValue = (...parts) => parts.join('-')

const safeValues = {
  DOMAIN: 'preview.invalid',
  ACME_EMAIL: 'acme@preview.invalid',
  POSTGRES_USER: 'synthetic_user',
  POSTGRES_PASSWORD: syntheticValue('synthetic', 'postgres', 'password'),
  POSTGRES_DB: 'synthetic_preview',
  REDIS_PASSWORD: syntheticValue('synthetic', 'redis', 'password'),
  S3_ENDPOINT: 'https://objects.preview.invalid',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'synthetic-product',
  S3_ACCESS_KEY: 'synthetic-access-key',
  S3_SECRET_KEY: syntheticValue('synthetic', 'object', 'credential'),
  BACKUP_S3_ENDPOINT: 'https://backups.preview.invalid',
  BACKUP_S3_REGION: 'us-east-1',
  BACKUP_S3_BUCKET: 'synthetic-backups',
  BACKUP_S3_PREFIX: 'database',
  BACKUP_S3_ACCESS_KEY: 'synthetic-backup-access',
  BACKUP_S3_SECRET_KEY: syntheticValue('synthetic', 'backup', 'credential'),
  SESSION_SECRET: syntheticValue('synthetic', 'session', 'value', 'thirty', 'two', 'characters'),
  METRICS_TOKEN: syntheticValue('synthetic', 'metrics', 'value', 'thirty', 'two', 'characters'),
}
writeFileSync(
  safeEnv,
  Object.entries(safeValues)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n'),
)

let passed = 0
function test(name, action) {
  action()
  passed += 1
  console.log(`PASS ${name}`)
}

function composeConfig(envFile) {
  return execFileSync(
    'docker',
    ['compose', '--env-file', envFile, '-f', composeFile, 'config', '--format', 'json'],
    { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH } },
  )
}

function service(config, name) {
  const value = config.services[name]
  assert(value, `missing Compose service ${name}`)
  return value
}

function executable(path, content) {
  writeFileSync(path, content)
  chmodSync(path, 0o755)
}

try {
  test('unchanged environment example fails closed', () => {
    const result = spawnSync(
      'docker',
      [
        'compose',
        '--env-file',
        join(root, 'deploy/.env.production.example'),
        '-f',
        composeFile,
        'config',
      ],
      { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH } },
    )
    assert.notEqual(result.status, 0)
  })

  const config = JSON.parse(composeConfig(safeEnv))

  test('Compose renders with a complete synthetic environment', () => {
    assert.equal(config.name, 'tozalist-prod')
  })

  test('only Caddy publishes host ports 80 and 443', () => {
    const published = []
    for (const [name, definition] of Object.entries(config.services)) {
      for (const port of definition.ports ?? []) published.push([name, Number(port.published)])
    }
    assert.deepEqual(
      published.sort((left, right) => left[1] - right[1]),
      [
        ['caddy', 80],
        ['caddy', 443],
        ['caddy', 443],
      ],
    )
  })

  test('Caddy cannot route to the private backend network', () => {
    assert.deepEqual(Object.keys(service(config, 'caddy').networks), ['edge'])
    for (const name of ['engine', 'postgres', 'redis', 'postgres-backup']) {
      assert.deepEqual(Object.keys(service(config, name).networks), ['backend'])
      assert.equal(service(config, name).ports, undefined)
    }
  })

  test('Redis is authenticated and append-only', () => {
    const redis = service(config, 'redis')
    assert(redis.command.includes('--appendonly'))
    assert(redis.command.includes('--requirepass'))
    assert.equal(redis.environment.REDISCLI_AUTH, safeValues.REDIS_PASSWORD)
  })

  test('SMTP remains disabled and metrics stay private', () => {
    for (const name of ['api', 'worker', 'engine']) {
      assert.equal(service(config, name).environment.SMTP_ENABLED, 'false')
    }
    assert.equal(service(config, 'api').environment.METRICS_TOKEN, safeValues.METRICS_TOKEN)
    assert.equal(service(config, 'worker').environment.METRICS_HOST, '127.0.0.1')
    assert(readFileSync(join(root, 'deploy/Caddyfile'), 'utf8').includes('respond /metrics 404'))
  })

  test('application startup receives every required product storage value', () => {
    for (const name of ['api', 'worker']) {
      const environment = service(config, name).environment
      for (const variable of [
        'S3_ENDPOINT',
        'S3_REGION',
        'S3_BUCKET',
        'S3_ACCESS_KEY',
        'S3_SECRET_KEY',
      ]) {
        assert.equal(environment[variable], safeValues[variable])
      }
    }
  })

  test('application images are non-root with real health checks and correct entrypoints', () => {
    const expectations = {
      api: 'ENTRYPOINT ["node", "apps/api/dist/server.js"]',
      worker: 'ENTRYPOINT ["node", "apps/worker/dist/main.js"]',
      web: 'WORKDIR /app/apps/web\nENTRYPOINT ["node", "server.js"]',
      dashboard: 'WORKDIR /app/apps/dashboard\nENTRYPOINT ["node", "server.js"]',
    }
    for (const [name, entrypoint] of Object.entries(expectations)) {
      const dockerfile = readFileSync(join(root, `apps/${name}/Dockerfile`), 'utf8')
      assert(dockerfile.includes('pnpm-workspace.yaml'))
      assert(dockerfile.includes('USER tozalist'))
      assert(dockerfile.includes('HEALTHCHECK'))
      assert(dockerfile.includes(entrypoint))
    }
    assert(readFileSync(join(root, 'apps/worker/Dockerfile'), 'utf8').includes('/metrics'))
  })

  test('Next standalone output and monorepo runtime layout are explicit', () => {
    for (const name of ['web', 'dashboard']) {
      assert(
        readFileSync(join(root, `apps/${name}/next.config.mjs`), 'utf8').includes(
          "output: 'standalone'",
        ),
      )
      const dockerfile = readFileSync(join(root, `apps/${name}/Dockerfile`), 'utf8')
      assert(dockerfile.includes(`./apps/${name}/.next/static`))
      assert(dockerfile.includes(`WORKDIR /app/apps/${name}`))
    }
  })

  test('Docker context excludes secrets and stale build artifacts', () => {
    const ignore = readFileSync(join(root, '.dockerignore'), 'utf8')
    for (const pattern of ['.git', '.env.*', '**/node_modules', '**/.next', '**/dist', 'docs']) {
      assert(ignore.includes(pattern))
    }
  })

  test('backup behavior uploads daily/weekly and retains exactly 7/4 remotely', () => {
    const fakeBin = join(scratch, 'fake-bin')
    const remote = join(scratch, 'remote')
    const local = join(scratch, 'backups')
    mkdirSync(fakeBin)
    mkdirSync(local)
    executable(
      join(fakeBin, 'pg_dump'),
      '#!/bin/sh\nprintf "create table synthetic_backup_proof(id integer);\\n"\n',
    )
    executable(
      join(fakeBin, 'date'),
      '#!/bin/sh\ncase "$*" in *%Y%m%dT%H%M%SZ*) echo 20260827T010203Z;; *%u*) echo 7;; *) /bin/date "$@";; esac\n',
    )
    executable(
      join(fakeBin, 'aws'),
      `#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'; import { dirname, join } from 'node:path';
const args=process.argv.slice(2); const root=process.env.FAKE_S3_ROOT; const serviceAt=args.findIndex(x=>x==='s3'||x==='s3api'); const service=args[serviceAt]; const op=args[serviceAt+1];
const parse=(value)=>{if(!value.startsWith('s3://')) throw new Error('bad s3 uri'); const rest=value.slice(5), slash=rest.indexOf('/'); if(slash<1) throw new Error('bad s3 uri'); return join(root,rest.slice(0,slash),rest.slice(slash+1))};
if(service==='s3'&&op==='cp'){const source=args[args.length-2], target=parse(args[args.length-1]); mkdirSync(dirname(target),{recursive:true}); cpSync(source,target);}
else if(service==='s3'&&op==='rm'){rmSync(parse(args[args.length-1]),{force:true});}
else if(service==='s3api'&&op==='list-objects-v2'){const bucket=args[args.indexOf('--bucket')+1], prefix=args[args.indexOf('--prefix')+1], base=join(root,bucket,prefix); const names=existsSync(base)?readdirSync(base).map(name=>prefix+name):[]; process.stdout.write(names.join('\\t'));}
else throw new Error('unsupported fake aws call: '+args.join(' '));
`,
    )
    for (const [kind, count] of [
      ['daily', 9],
      ['weekly', 6],
    ]) {
      const directory = join(remote, safeValues.BACKUP_S3_BUCKET, safeValues.BACKUP_S3_PREFIX, kind)
      mkdirSync(directory, { recursive: true })
      for (let index = 0; index < count; index += 1) {
        writeFileSync(
          join(directory, `tozalist-202608${String(index + 1).padStart(2, '0')}T000000Z.sql.gz`),
          'x',
        )
      }
    }
    const result = spawnSync('bash', [join(root, 'deploy/backup.sh')], {
      cwd: root,
      encoding: 'utf8',
      env: {
        PATH: `${fakeBin}:${process.env.PATH}`,
        POSTGRES_HOST: 'postgres',
        POSTGRES_PORT: '5432',
        POSTGRES_USER: 'synthetic',
        POSTGRES_DB: 'synthetic',
        PGPASSWORD: 'synthetic-password',
        BACKUP_S3_ENDPOINT: 'https://backups.preview.invalid',
        BACKUP_S3_REGION: 'us-east-1',
        BACKUP_S3_BUCKET: safeValues.BACKUP_S3_BUCKET,
        BACKUP_S3_PREFIX: safeValues.BACKUP_S3_PREFIX,
        AWS_ACCESS_KEY_ID: 'synthetic',
        AWS_SECRET_ACCESS_KEY: 'synthetic',
        BACKUP_DIR: local,
        FAKE_S3_ROOT: remote,
      },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(
      readdirSync(join(remote, safeValues.BACKUP_S3_BUCKET, safeValues.BACKUP_S3_PREFIX, 'daily'))
        .length,
      7,
    )
    assert.equal(
      readdirSync(join(remote, safeValues.BACKUP_S3_BUCKET, safeValues.BACKUP_S3_PREFIX, 'weekly'))
        .length,
      4,
    )
    assert(existsSync(join(local, '.last-backup')))
  })

  test('restore refuses production and completes only a confirmed disposable drill', () => {
    const fakeBin = join(scratch, 'restore-bin')
    const log = join(scratch, 'restore.log')
    const backup = join(scratch, 'restore.sql.gz')
    mkdirSync(fakeBin)
    writeFileSync(
      join(scratch, 'restore.sql'),
      'create table synthetic_restore_proof(id integer);\n',
    )
    const compressed = execFileSync('gzip', ['-c', join(scratch, 'restore.sql')])
    writeFileSync(backup, compressed)
    for (const name of ['dropdb', 'createdb']) {
      executable(
        join(fakeBin, name),
        `#!/bin/sh\nprintf '${name} %s\\n' "$*" >>"$FAKE_RESTORE_LOG"\n`,
      )
    }
    executable(
      join(fakeBin, 'psql'),
      '#!/bin/sh\nprintf "psql %s\\n" "$*" >>"$FAKE_RESTORE_LOG"\ncase "$*" in *"select 1"*) echo 1;; *) cat >/dev/null;; esac\n',
    )
    const baseEnv = {
      PATH: `${fakeBin}:${process.env.PATH}`,
      POSTGRES_HOST: 'postgres',
      POSTGRES_PORT: '5432',
      POSTGRES_USER: 'synthetic',
      POSTGRES_DB: 'synthetic_production',
      PGPASSWORD: 'synthetic-password',
      FAKE_RESTORE_LOG: log,
    }
    const refused = spawnSync('bash', [join(root, 'deploy/restore.sh'), backup], {
      env: {
        ...baseEnv,
        RESTORE_TARGET_DATABASE: 'synthetic_production',
        RESTORE_CONFIRMATION: 'restore-disposable:synthetic_production',
      },
    })
    assert.notEqual(refused.status, 0)
    assert(!existsSync(log))
    const target = 'synthetic_restore_drill'
    const restored = spawnSync('bash', [join(root, 'deploy/restore.sh'), backup], {
      encoding: 'utf8',
      env: {
        ...baseEnv,
        RESTORE_TARGET_DATABASE: target,
        RESTORE_CONFIRMATION: `restore-disposable:${target}`,
      },
    })
    assert.equal(restored.status, 0, restored.stderr)
    const calls = readFileSync(log, 'utf8')
    assert(calls.includes(`dropdb`) && calls.includes(target))
    assert(calls.includes(`createdb`) && calls.includes(target))
    assert(calls.includes('select 1'))
  })

  test('smoke contract uses real routes, multipart, synthetic fixtures, and environment-only key', () => {
    const smoke = readFileSync(join(root, 'scripts/smoke-test.mjs'), 'utf8')
    for (const value of [
      '/v1/email/check',
      '/v1/batches',
      'FormData',
      'SMOKE_API_KEY',
      '.invalid',
    ]) {
      assert(smoke.includes(value))
    }
    assert(!smoke.includes('rejectUnauthorized: false'))
    assert(!smoke.includes('apiUrl.replace'))
    assert(!smoke.includes('sk_live_'))
  })

  test('Caddy configuration validates in the pinned image', () => {
    const caddyContext = join(scratch, 'caddy-validate')
    mkdirSync(caddyContext)
    writeFileSync(join(caddyContext, 'Caddyfile'), readFileSync(join(root, 'deploy/Caddyfile')))
    writeFileSync(
      join(caddyContext, 'Dockerfile'),
      [
        'FROM caddy:2.8.4-alpine',
        'COPY Caddyfile /etc/caddy/Caddyfile',
        `ENV DOMAIN=${safeValues.DOMAIN}`,
        `ENV ACME_EMAIL=${safeValues.ACME_EMAIL}`,
        'ENV WEB_ORIGIN=http://web:3000',
        'ENV DASHBOARD_ORIGIN=http://dashboard:3002',
        'ENV API_ORIGIN=http://api:3001',
        'RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile',
        '',
      ].join('\n'),
    )
    execFileSync(
      'docker',
      [
        'build',
        '--file',
        join(caddyContext, 'Dockerfile'),
        '--output',
        'type=cacheonly',
        caddyContext,
      ],
      { cwd: root, stdio: 'pipe', timeout: 120_000 },
    )
  })

  console.log(`Deployment verification passed: ${passed} checks.`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
