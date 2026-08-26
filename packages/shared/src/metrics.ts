/**
 * A minimal Prometheus instrumentation library (roadmap 8.1): counters,
 * gauges, and fixed-bucket histograms rendered in text exposition format
 * 0.0.4. Hand-rolled - ~120 lines - instead of prom-client, whose
 * @opentelemetry/api dependency split the workspace's peer resolution.
 *
 * Label values must come from closed sets (route patterns, methods, statuses,
 * outcome enums) so cardinality stays bounded; nothing request-derived may be
 * used as a label.
 */

type Labels = Readonly<Record<string, string>>

function labelKey(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((key) => `${key}=${labels[key]}`)
    .join(',')
}

function renderLabels(labels: Labels): string {
  const entries = Object.keys(labels)
    .sort()
    .map((key) => `${key}="${(labels[key] ?? '').replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`)
  return entries.length > 0 ? `{${entries.join(',')}}` : ''
}

export class Counter {
  private readonly series = new Map<string, { labels: Labels; value: number }>()
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  inc(labels: Labels = {}, amount = 1): void {
    const key = labelKey(labels)
    const entry = this.series.get(key) ?? { labels, value: 0 }
    entry.value += amount
    this.series.set(key, entry)
  }

  value(labels: Labels = {}): number {
    return this.series.get(labelKey(labels))?.value ?? 0
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`]
    for (const { labels, value } of this.series.values()) {
      lines.push(`${this.name}${renderLabels(labels)} ${value}`)
    }
    return lines.join('\n')
  }
}

export class Gauge {
  private readonly series = new Map<string, { labels: Labels; value: number }>()
  /** Optional callback run at scrape time to refresh values (queue depth). */
  private collector: (() => Promise<void> | void) | null = null

  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  set(labels: Labels, value: number): void {
    this.series.set(labelKey(labels), { labels, value })
  }

  onCollect(collector: () => Promise<void> | void): void {
    this.collector = collector
  }

  async collect(): Promise<void> {
    await this.collector?.()
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`]
    for (const { labels, value } of this.series.values()) {
      lines.push(`${this.name}${renderLabels(labels)} ${value}`)
    }
    return lines.join('\n')
  }
}

export class Histogram {
  private readonly series = new Map<
    string,
    { labels: Labels; buckets: number[]; sum: number; count: number }
  >()

  constructor(
    readonly name: string,
    readonly help: string,
    readonly bounds: readonly number[],
  ) {}

  observe(labels: Labels, value: number): void {
    const key = labelKey(labels)
    const entry =
      this.series.get(key) ??
      ({ labels, buckets: this.bounds.map(() => 0), sum: 0, count: 0 } as {
        labels: Labels
        buckets: number[]
        sum: number
        count: number
      })
    for (let index = 0; index < this.bounds.length; index += 1) {
      const bound = this.bounds[index]
      if (bound !== undefined && value <= bound) {
        entry.buckets[index] = (entry.buckets[index] ?? 0) + 1
      }
    }
    entry.sum += value
    entry.count += 1
    this.series.set(key, entry)
  }

  count(labels: Labels = {}): number {
    return this.series.get(labelKey(labels))?.count ?? 0
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`]
    for (const { labels, buckets, sum, count } of this.series.values()) {
      for (let index = 0; index < this.bounds.length; index += 1) {
        const bucketLabels = { ...labels, le: String(this.bounds[index]) }
        lines.push(`${this.name}_bucket${renderLabels(bucketLabels)} ${buckets[index]}`)
      }
      lines.push(`${this.name}_bucket${renderLabels({ ...labels, le: '+Inf' })} ${count}`)
      lines.push(`${this.name}_sum${renderLabels(labels)} ${sum}`)
      lines.push(`${this.name}_count${renderLabels(labels)} ${count}`)
    }
    return lines.join('\n')
  }
}

export class MetricsRegistry {
  readonly contentType = 'text/plain; version=0.0.4; charset=utf-8'
  private readonly metrics: Array<Counter | Gauge | Histogram> = []

  counter(name: string, help: string): Counter {
    const metric = new Counter(name, help)
    this.metrics.push(metric)
    return metric
  }

  gauge(name: string, help: string): Gauge {
    const metric = new Gauge(name, help)
    this.metrics.push(metric)
    return metric
  }

  histogram(name: string, help: string, bounds: readonly number[]): Histogram {
    const metric = new Histogram(name, help, bounds)
    this.metrics.push(metric)
    return metric
  }

  async render(): Promise<string> {
    for (const metric of this.metrics) {
      if (metric instanceof Gauge) await metric.collect()
    }
    return this.metrics.map((metric) => metric.render()).join('\n') + '\n'
  }
}
