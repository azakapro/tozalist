import { describe, expect, it } from 'vitest'
import { MetricsRegistry } from './metrics.js'

describe('metrics registry', () => {
  it('renders counters with escaped labels in exposition format', async () => {
    const registry = new MetricsRegistry()
    const requests = registry.counter('http_requests_total', 'Requests.')
    requests.inc({ route: '/v1/email/check', status: '200' })
    requests.inc({ route: '/v1/email/check', status: '200' })
    requests.inc({ route: '/v1/email/check', status: '404' })

    const text = await registry.render()
    expect(text).toContain('# TYPE http_requests_total counter')
    expect(text).toContain('http_requests_total{route="/v1/email/check",status="200"} 2')
    expect(text).toContain('http_requests_total{route="/v1/email/check",status="404"} 1')
    expect(requests.value({ route: '/v1/email/check', status: '200' })).toBe(2)
  })

  it('histograms bucket cumulatively with sum, count, and +Inf', async () => {
    const registry = new MetricsRegistry()
    const latency = registry.histogram('latency_seconds', 'Latency.', [0.1, 0.5, 1])
    latency.observe({ route: '/x' }, 0.05)
    latency.observe({ route: '/x' }, 0.3)
    latency.observe({ route: '/x' }, 2)

    const text = await registry.render()
    expect(text).toContain('latency_seconds_bucket{le="0.1",route="/x"} 1')
    expect(text).toContain('latency_seconds_bucket{le="0.5",route="/x"} 2')
    expect(text).toContain('latency_seconds_bucket{le="1",route="/x"} 2')
    expect(text).toContain('latency_seconds_bucket{le="+Inf",route="/x"} 3')
    expect(text).toContain('latency_seconds_count{route="/x"} 3')
    expect(text).toContain('latency_seconds_sum{route="/x"} 2.35')
  })

  it('gauges refresh through their collect callback at scrape time', async () => {
    const registry = new MetricsRegistry()
    const depth = registry.gauge('queue_depth', 'Depth.')
    let current = 0
    depth.onCollect(() => depth.set({ queue: 'smtp' }, current))
    current = 7
    expect(await registry.render()).toContain('queue_depth{queue="smtp"} 7')
    current = 3
    expect(await registry.render()).toContain('queue_depth{queue="smtp"} 3')
  })
})
