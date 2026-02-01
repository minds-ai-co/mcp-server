/**
 * Rate Limiting Middleware for MCP Server
 * Protects against abuse and DoS attacks
 */

import { logger } from '../config'

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Max requests per window for unauthenticated users (per IP) */
  unauthenticatedLimit: number
  /** Max requests per window for authenticated users */
  authenticatedLimit: number
  /** Time window in milliseconds */
  windowMs: number
  /** Stricter limits for specific operations */
  operationLimits: Record<string, number>
}

/**
 * Default rate limit configuration
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  unauthenticatedLimit: 100,  // 100 requests per minute for unauthenticated
  authenticatedLimit: 1000,    // 1000 requests per minute for authenticated
  windowMs: 60 * 1000,         // 1 minute window
  operationLimits: {
    'create_ai_persona_or_digital_twin': 20,  // 20 creates per minute
    'talk_to_ai_persona': 60,                  // 60 chat messages per minute
    'tools/call': 100,                         // 100 tool calls per minute
  },
}

/**
 * Rate limit entry tracking requests in current window
 */
interface RateLimitEntry {
  count: number
  windowStart: number
  operationCounts: Map<string, number>
}

/**
 * Rate limiter instance
 */
class RateLimiter {
  private entries = new Map<string, RateLimitEntry>()
  private config: RateLimitConfig
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor(config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG) {
    this.config = config
    this.startCleanup()
  }

  /**
   * Start periodic cleanup of expired entries
   */
  private startCleanup(): void {
    // Clean up every minute
    this.cleanupInterval = setInterval(() => {
      const now = Date.now()
      for (const [key, entry] of this.entries) {
        if (now - entry.windowStart > this.config.windowMs * 2) {
          this.entries.delete(key)
        }
      }
    }, 60 * 1000)

    // Don't prevent process exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref()
    }
  }

  /**
   * Stop cleanup interval
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  /**
   * Get or create rate limit entry for a key
   */
  private getEntry(key: string): RateLimitEntry {
    const now = Date.now()
    let entry = this.entries.get(key)

    if (!entry || now - entry.windowStart > this.config.windowMs) {
      // Create new window
      entry = {
        count: 0,
        windowStart: now,
        operationCounts: new Map(),
      }
      this.entries.set(key, entry)
    }

    return entry
  }

  /**
   * Check if request should be rate limited
   * @returns Object with allowed flag and retry-after in seconds
   */
  check(
    identifier: string,
    isAuthenticated: boolean,
    operation?: string
  ): { allowed: boolean; retryAfter: number; remaining: number; limit: number } {
    const entry = this.getEntry(identifier)
    const now = Date.now()
    const limit = isAuthenticated
      ? this.config.authenticatedLimit
      : this.config.unauthenticatedLimit

    // Check overall limit
    if (entry.count >= limit) {
      const retryAfter = Math.ceil((entry.windowStart + this.config.windowMs - now) / 1000)
      logger.warn('Rate limit exceeded', {
        identifier: identifier.slice(0, 20) + '...',
        count: entry.count,
        limit,
        operation,
      })
      return {
        allowed: false,
        retryAfter: Math.max(1, retryAfter),
        remaining: 0,
        limit,
      }
    }

    // Check operation-specific limit
    if (operation && this.config.operationLimits[operation]) {
      const opLimit = this.config.operationLimits[operation]
      const opCount = entry.operationCounts.get(operation) || 0

      if (opCount >= opLimit) {
        const retryAfter = Math.ceil((entry.windowStart + this.config.windowMs - now) / 1000)
        logger.warn('Operation rate limit exceeded', {
          identifier: identifier.slice(0, 20) + '...',
          operation,
          count: opCount,
          limit: opLimit,
        })
        return {
          allowed: false,
          retryAfter: Math.max(1, retryAfter),
          remaining: 0,
          limit: opLimit,
        }
      }
    }

    return {
      allowed: true,
      retryAfter: 0,
      remaining: limit - entry.count - 1,
      limit,
    }
  }

  /**
   * Record a request (call after check passes)
   */
  record(identifier: string, operation?: string): void {
    const entry = this.getEntry(identifier)
    entry.count++

    if (operation) {
      const opCount = entry.operationCounts.get(operation) || 0
      entry.operationCounts.set(operation, opCount + 1)
    }
  }

  /**
   * Get current stats for an identifier
   */
  getStats(identifier: string): { count: number; windowRemaining: number } | null {
    const entry = this.entries.get(identifier)
    if (!entry) return null

    const now = Date.now()
    if (now - entry.windowStart > this.config.windowMs) return null

    return {
      count: entry.count,
      windowRemaining: Math.ceil((entry.windowStart + this.config.windowMs - now) / 1000),
    }
  }
}

// Singleton instance
let rateLimiterInstance: RateLimiter | null = null

/**
 * Get the rate limiter instance
 */
export function getRateLimiter(config?: RateLimitConfig): RateLimiter {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new RateLimiter(config)
  }
  return rateLimiterInstance
}

/**
 * Rate limit check result with headers
 */
export interface RateLimitResult {
  allowed: boolean
  headers: Record<string, string>
}

/**
 * Check rate limit for an incoming request
 * @param ip Client IP address
 * @param userId Authenticated user ID (if any)
 * @param operation Optional operation name for stricter limits
 * @returns Rate limit check result with headers
 */
export function checkRateLimit(
  ip: string,
  userId: string | null,
  operation?: string
): RateLimitResult {
  const limiter = getRateLimiter()
  const identifier = userId || `ip:${ip}`
  const isAuthenticated = !!userId

  const result = limiter.check(identifier, isAuthenticated, operation)

  if (result.allowed) {
    limiter.record(identifier, operation)
  }

  const headers: Record<string, string> = {
    'X-RateLimit-Limit': result.limit.toString(),
    'X-RateLimit-Remaining': Math.max(0, result.remaining).toString(),
  }

  if (!result.allowed) {
    headers['Retry-After'] = result.retryAfter.toString()
  }

  return {
    allowed: result.allowed,
    headers,
  }
}

/**
 * Get client IP from request headers
 */
export function getClientIp(headers: Record<string, string | string[] | undefined>): string {
  // Check common proxy headers
  const forwardedFor = headers['x-forwarded-for']
  if (forwardedFor) {
    const ip = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor.split(',')[0]
    return ip.trim()
  }

  const realIp = headers['x-real-ip']
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp
  }

  // CF-Connecting-IP for Cloudflare
  const cfIp = headers['cf-connecting-ip']
  if (cfIp) {
    return Array.isArray(cfIp) ? cfIp[0] : cfIp
  }

  return '0.0.0.0'
}
