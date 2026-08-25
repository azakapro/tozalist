import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { Worker } from 'bullmq'
import {
  buildWorkerMetrics,
  instrumentEngine,
  instrumentWorker,
  startMetricsServer,
  trackQueueDepth,
} from './metrics.js'
import type { EngineVerifier } from './smtp/types.js'

describe('worker metrics', () => {
  it('counts job outcomes and observes durations from worker events', async () => {
    const metrics = buildWorkerMetrics()
    const emitter = new EventEmitter()
    instrumentWorker(emitter as unknown as Pick<Worker, 'on'>, 'smtp-probe', metrics)

    emitter.emit('completed', { processedOn: 1000, finishedOn: 1250 })
    emitter.emit('completed', { processedOn: 2000, finishedOn: 2100 })
    emitter.emit('failed', { processedOn: 3000, finishedOn: 3500 })
    emitter.emit('failed', undefined) // a failed job may arrive without data

    const text = await metrics.registry.render()
    expect(text).toContain('tozalist_worker_jobs_total{outcome="completed",queue="smtp-probe"} 2')
    expect(text).toContain('tozalist_worker_jobs_total{outcome="failed",queue="smtp-probe"} 2')
    expect(text).toContain('tozalist_worker_job_duration_seconds_count{queue="smtp-probe"} 3')
  })

  it('samples queue depth at scrape time via getJobCounts', async () => {
    const metrics = buildWorkerMetrics()
    let waiting = 5
    trackQueueDepth(metrics, [
      {
        name: 'batch-process',
        queue: {
          getJobCounts: () => Promise.resolve({ waiting, delayed: 2, active: 1 }),
        },
      },
    ])
    expect(await metrics.registry.render()).toContain(
      'tozalist_queue_depth{queue="batch-process"} 8',
    )
    waiting = 0
    expect(await metrics.registry.render()).toContain(
      'tozalist_queue_depth{queue="batch-process"} 3',
    )
  })

  it('wraps the engine: latency histogram plus ok/error counters', async () => {
    const metrics = buildWorkerMetrics()
    const flaky: EngineVerifier = {
      verify: (email) =>
        email === 'bad@example.com'
          ? Promise.reject(new Error('engine down'))
          : Promise.resolve({} as never),
    }
    const engine = instrumentEngine(flaky, metrics)
    await engine.verify('ok@example.com', { smtp: false, catchAll: false })
    await expect(
      engine.verify('bad@example.com', { smtp: false, catchAll: false }),
    ).rejects.toThrow('engine down')

    const text = await metrics.registry.render()
    expect(text).toContain('tozalist_engine_calls_total{outcome="ok"} 1')
    expect(text).toContain('tozalist_engine_calls_total{outcome="error"} 1')
    expect(text).toContain('tozalist_engine_call_duration_seconds_count 2')
  })

  it('serves /metrics over HTTP, binds to loopback by default, 404s everything else', async () => {
    const metrics = buildWorkerMetrics()
    metrics.smtpOutcomes.inc({ outcome: 'ok' })
    const server = startMetricsServer(metrics.registry, 0)
    await new Promise((resolve) => server.once('listening', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no port')
    try {
      // Loopback by default: another interface is an explicit deploy choice.
      expect(address.address).toBe('127.0.0.1')
      const response = await fetch(`http://127.0.0.1:${address.port}/metrics`)
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('tozalist_smtp_probe_outcomes_total{outcome="ok"} 1')
      const missing = await fetch(`http://127.0.0.1:${address.port}/other`)
      expect(missing.status).toBe(404)
    } finally {
      server.close()
    }
  })
})
