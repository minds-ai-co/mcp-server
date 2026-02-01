/**
 * Circuit Breaker for MCP Server
 * Provides resilience for API calls with automatic failure handling
 */

import { logger } from '../config'
import { metrics } from './metrics'

/**
 * Circuit breaker states
 */
export type CircuitState = 'closed' | 'open' | 'half-open'

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit */
  failureThreshold: number
  /** Time in ms to wait before trying again (half-open state) */
  resetTimeout: number
  /** Number of successful calls needed to close the circuit from half-open */
  successThreshold: number
  /** Optional name for logging */
  name: string
}

/**
 * Default circuit breaker configuration
 */
export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 30000, // 30 seconds
  successThreshold: 2,
  name: 'default',
}

/**
 * Circuit breaker instance
 */
class CircuitBreaker {
  private state: CircuitState = 'closed'
  private failures = 0
  private successes = 0
  private lastFailureTime = 0
  private config: CircuitBreakerConfig

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_CONFIG, ...config }
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    // Check if we should transition from open to half-open
    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastFailureTime
      if (elapsed >= this.config.resetTimeout) {
        this.transitionTo('half-open')
      }
    }
    return this.state
  }

  /**
   * Check if circuit allows requests
   */
  isAllowed(): boolean {
    const state = this.getState()
    return state === 'closed' || state === 'half-open'
  }

  /**
   * Record a successful call
   */
  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.successes++
      if (this.successes >= this.config.successThreshold) {
        this.transitionTo('closed')
      }
    } else if (this.state === 'closed') {
      // Reset failure count on success
      this.failures = 0
    }
  }

  /**
   * Record a failed call
   */
  recordFailure(): void {
    this.failures++
    this.lastFailureTime = Date.now()

    if (this.state === 'half-open') {
      // Any failure in half-open state opens the circuit
      this.transitionTo('open')
    } else if (this.state === 'closed' && this.failures >= this.config.failureThreshold) {
      this.transitionTo('open')
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state
    this.state = newState

    if (newState === 'closed') {
      this.failures = 0
      this.successes = 0
    } else if (newState === 'half-open') {
      this.successes = 0
    }

    logger.info('Circuit breaker state change', {
      name: this.config.name,
      from: oldState,
      to: newState,
      failures: this.failures,
    })

    metrics.recordCircuitBreakerState(this.config.name, newState)
  }

  /**
   * Reset the circuit breaker
   */
  reset(): void {
    this.transitionTo('closed')
  }

  /**
   * Get circuit breaker stats
   */
  getStats(): {
    state: CircuitState
    failures: number
    successes: number
    lastFailureTime: number | null
  } {
    return {
      state: this.getState(),
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime || null,
    }
  }
}

/**
 * Map of circuit breakers by name
 */
const circuitBreakers = new Map<string, CircuitBreaker>()

/**
 * Get or create a circuit breaker
 */
export function getCircuitBreaker(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
  let breaker = circuitBreakers.get(name)
  if (!breaker) {
    breaker = new CircuitBreaker({ ...config, name })
    circuitBreakers.set(name, breaker)
  }
  return breaker
}

/**
 * Execute a function with circuit breaker protection
 */
export async function withCircuitBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  options?: {
    fallback?: () => T | Promise<T>
    config?: Partial<CircuitBreakerConfig>
  }
): Promise<T> {
  const breaker = getCircuitBreaker(name, options?.config)

  if (!breaker.isAllowed()) {
    logger.warn('Circuit breaker is open', { name })

    if (options?.fallback) {
      return options.fallback()
    }

    throw new CircuitBreakerOpenError(name)
  }

  try {
    const result = await fn()
    breaker.recordSuccess()
    return result
  } catch (error) {
    breaker.recordFailure()

    // If we have a fallback and circuit just opened, use it
    if (options?.fallback && !breaker.isAllowed()) {
      logger.warn('Circuit breaker opened, using fallback', { name })
      return options.fallback()
    }

    throw error
  }
}

/**
 * Error thrown when circuit breaker is open
 */
export class CircuitBreakerOpenError extends Error {
  constructor(public readonly circuitName: string) {
    super(`Circuit breaker "${circuitName}" is open`)
    this.name = 'CircuitBreakerOpenError'
  }
}

/**
 * Get stats for all circuit breakers
 */
export function getAllCircuitBreakerStats(): Record<string, ReturnType<CircuitBreaker['getStats']>> {
  const stats: Record<string, ReturnType<CircuitBreaker['getStats']>> = {}
  for (const [name, breaker] of circuitBreakers) {
    stats[name] = breaker.getStats()
  }
  return stats
}

/**
 * Reset all circuit breakers
 */
export function resetAllCircuitBreakers(): void {
  for (const breaker of circuitBreakers.values()) {
    breaker.reset()
  }
}
