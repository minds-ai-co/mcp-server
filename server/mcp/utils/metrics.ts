/**
 * Metrics Collection for MCP Server
 * Tracks request rates, latencies, errors, and tool usage
 */

import { logger } from '../config'

/**
 * Metric types
 */
export type MetricType = 'counter' | 'gauge' | 'histogram'

/**
 * Histogram bucket configuration
 */
const LATENCY_BUCKETS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] // ms

/**
 * Counter metric
 */
interface Counter {
  type: 'counter'
  value: number
  labels: Map<string, number>
}

/**
 * Gauge metric
 */
interface Gauge {
  type: 'gauge'
  value: number
  labels: Map<string, number>
}

/**
 * Histogram metric
 */
interface Histogram {
  type: 'histogram'
  buckets: Map<number, number>
  sum: number
  count: number
  labels: Map<string, { buckets: Map<number, number>; sum: number; count: number }>
}

/**
 * Metrics store
 */
class MetricsStore {
  private counters = new Map<string, Counter>()
  private gauges = new Map<string, Gauge>()
  private histograms = new Map<string, Histogram>()
  private startTime = Date.now()

  /**
   * Get or create a counter
   */
  private getCounter(name: string): Counter {
    let counter = this.counters.get(name)
    if (!counter) {
      counter = { type: 'counter', value: 0, labels: new Map() }
      this.counters.set(name, counter)
    }
    return counter
  }

  /**
   * Get or create a gauge
   */
  private getGauge(name: string): Gauge {
    let gauge = this.gauges.get(name)
    if (!gauge) {
      gauge = { type: 'gauge', value: 0, labels: new Map() }
      this.gauges.set(name, gauge)
    }
    return gauge
  }

  /**
   * Get or create a histogram
   */
  private getHistogram(name: string): Histogram {
    let histogram = this.histograms.get(name)
    if (!histogram) {
      const buckets = new Map<number, number>()
      for (const bucket of LATENCY_BUCKETS) {
        buckets.set(bucket, 0)
      }
      buckets.set(Infinity, 0)
      histogram = { type: 'histogram', buckets, sum: 0, count: 0, labels: new Map() }
      this.histograms.set(name, histogram)
    }
    return histogram
  }

  /**
   * Increment a counter
   */
  incCounter(name: string, labels?: Record<string, string>, value: number = 1): void {
    const counter = this.getCounter(name)
    counter.value += value

    if (labels) {
      const labelKey = this.labelsToKey(labels)
      const current = counter.labels.get(labelKey) || 0
      counter.labels.set(labelKey, current + value)
    }
  }

  /**
   * Set a gauge value
   */
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const gauge = this.getGauge(name)
    gauge.value = value

    if (labels) {
      const labelKey = this.labelsToKey(labels)
      gauge.labels.set(labelKey, value)
    }
  }

  /**
   * Increment a gauge
   */
  incGauge(name: string, labels?: Record<string, string>, value: number = 1): void {
    const gauge = this.getGauge(name)
    gauge.value += value

    if (labels) {
      const labelKey = this.labelsToKey(labels)
      const current = gauge.labels.get(labelKey) || 0
      gauge.labels.set(labelKey, current + value)
    }
  }

  /**
   * Decrement a gauge
   */
  decGauge(name: string, labels?: Record<string, string>, value: number = 1): void {
    this.incGauge(name, labels, -value)
  }

  /**
   * Record a histogram value
   */
  recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const histogram = this.getHistogram(name)
    histogram.sum += value
    histogram.count++

    // Update buckets
    for (const [bucket] of histogram.buckets) {
      if (value <= bucket) {
        histogram.buckets.set(bucket, (histogram.buckets.get(bucket) || 0) + 1)
      }
    }

    // Update labeled buckets
    if (labels) {
      const labelKey = this.labelsToKey(labels)
      let labeledData = histogram.labels.get(labelKey)

      if (!labeledData) {
        const buckets = new Map<number, number>()
        for (const bucket of LATENCY_BUCKETS) {
          buckets.set(bucket, 0)
        }
        buckets.set(Infinity, 0)
        labeledData = { buckets, sum: 0, count: 0 }
        histogram.labels.set(labelKey, labeledData)
      }

      labeledData.sum += value
      labeledData.count++

      for (const [bucket] of labeledData.buckets) {
        if (value <= bucket) {
          labeledData.buckets.set(bucket, (labeledData.buckets.get(bucket) || 0) + 1)
        }
      }
    }
  }

  /**
   * Convert labels object to string key
   */
  private labelsToKey(labels: Record<string, string>): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',')
  }

  /**
   * Get uptime in seconds
   */
  getUptime(): number {
    return Math.floor((Date.now() - this.startTime) / 1000)
  }

  /**
   * Get all metrics as an object
   */
  getMetrics(): {
    counters: Record<string, { value: number; labels: Record<string, number> }>
    gauges: Record<string, { value: number; labels: Record<string, number> }>
    histograms: Record<string, { sum: number; count: number; avg: number }>
    uptime: number
  } {
    const counters: Record<string, { value: number; labels: Record<string, number> }> = {}
    const gauges: Record<string, { value: number; labels: Record<string, number> }> = {}
    const histograms: Record<string, { sum: number; count: number; avg: number }> = {}

    for (const [name, counter] of this.counters) {
      counters[name] = {
        value: counter.value,
        labels: Object.fromEntries(counter.labels),
      }
    }

    for (const [name, gauge] of this.gauges) {
      gauges[name] = {
        value: gauge.value,
        labels: Object.fromEntries(gauge.labels),
      }
    }

    for (const [name, histogram] of this.histograms) {
      histograms[name] = {
        sum: histogram.sum,
        count: histogram.count,
        avg: histogram.count > 0 ? Math.round(histogram.sum / histogram.count) : 0,
      }
    }

    return {
      counters,
      gauges,
      histograms,
      uptime: this.getUptime(),
    }
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.counters.clear()
    this.gauges.clear()
    this.histograms.clear()
    this.startTime = Date.now()
  }
}

// Singleton instance
const metricsStore = new MetricsStore()

/**
 * MCP-specific metrics helper
 */
export const metrics = {
  /**
   * Record an incoming request
   */
  recordRequest(method: string): void {
    metricsStore.incCounter('mcp_requests_total', { method })
  },

  /**
   * Record request duration
   */
  recordRequestDuration(durationMs: number, method: string): void {
    metricsStore.recordHistogram('mcp_request_duration_ms', durationMs, { method })
  },

  /**
   * Record a tool invocation
   */
  recordToolInvocation(tool: string, status: 'success' | 'error'): void {
    metricsStore.incCounter('mcp_tool_invocations_total', { tool, status })
  },

  /**
   * Record tool execution duration
   */
  recordToolDuration(tool: string, durationMs: number): void {
    metricsStore.recordHistogram('mcp_tool_duration_ms', durationMs, { tool })
  },

  /**
   * Record an error
   */
  recordError(errorCode: string): void {
    metricsStore.incCounter('mcp_errors_total', { error_code: errorCode })
  },

  /**
   * Track active connections
   */
  incActiveConnections(): void {
    metricsStore.incGauge('mcp_active_connections')
  },

  decActiveConnections(): void {
    metricsStore.decGauge('mcp_active_connections')
  },

  /**
   * Record authentication attempt
   */
  recordAuthAttempt(success: boolean): void {
    metricsStore.incCounter('mcp_auth_attempts_total', {
      status: success ? 'success' : 'failure',
    })
  },

  /**
   * Record rate limit hit
   */
  recordRateLimitHit(identifier: string): void {
    metricsStore.incCounter('mcp_rate_limit_hits_total')
  },

  /**
   * Record circuit breaker state change
   */
  recordCircuitBreakerState(name: string, state: 'closed' | 'open' | 'half-open'): void {
    metricsStore.setGauge('mcp_circuit_breaker_state', state === 'open' ? 1 : 0, { name })
  },

  /**
   * Get all metrics
   */
  getAll(): ReturnType<MetricsStore['getMetrics']> {
    return metricsStore.getMetrics()
  },

  /**
   * Get uptime
   */
  getUptime(): number {
    return metricsStore.getUptime()
  },

  /**
   * Reset metrics
   */
  reset(): void {
    metricsStore.reset()
  },
}

/**
 * Timer utility for measuring durations
 */
export function startTimer(): () => number {
  const start = performance.now()
  return () => Math.round(performance.now() - start)
}
