/**
 * Module-level caches for MCP server
 * These persist across requests within the same process
 */

import { CACHE_TTL, logger } from '../config'

/**
 * Cache for spark creation deduplication
 * Prevents duplicate sparks when ChatGPT retries tool calls
 * Key: userId + creationKey, Value: { sparkId, timestamp }
 */
export const sparkCreationCache = new Map<string, { sparkId: string; timestamp: number }>()

/**
 * Cache for pending spark creation promises
 * Prevents parallel duplicate requests from creating multiple sparks
 * Key: cacheKey, Value: Promise that resolves to sparkId
 */
export const pendingCreations = new Map<string, Promise<string>>()

/**
 * Cache for OAuth token → userId mapping
 * Avoids re-validating tokens on each request
 * Key: token, Value: { userId, timestamp }
 */
export const tokenUserIdCache = new Map<string, { userId: string; timestamp: number }>()

/**
 * Cache for latest spark created per user
 * Enables widget to find the spark even across different server instances
 * Key: userId, Value: { sparkId, timestamp }
 */
export const latestSparkCache = new Map<string, { sparkId: string; timestamp: number }>()

/**
 * Cache for pending widget tokens
 * Used to correlate resources/read with tool calls when auth not available
 * Key: widgetToken, Value: { sparkId?, timestamp, userId? }
 */
export const pendingWidgetTokens = new Map<string, {
  sparkId?: string
  timestamp: number
  userId?: string
}>()

/**
 * Clean up expired entries from all caches
 * Call this periodically to prevent memory leaks
 */
export function cleanupCaches(): void {
  const now = Date.now()

  // Clean spark creation cache
  const sparkCreationCutoff = now - CACHE_TTL.SPARK_CREATION
  for (const [key, data] of sparkCreationCache.entries()) {
    if (data.timestamp < sparkCreationCutoff) {
      sparkCreationCache.delete(key)
    }
  }

  // Clean token cache
  const tokenCutoff = now - CACHE_TTL.TOKEN_VALIDATION
  for (const [key, data] of tokenUserIdCache.entries()) {
    if (data.timestamp < tokenCutoff) {
      tokenUserIdCache.delete(key)
    }
  }

  // Clean latest spark cache
  const latestSparkCutoff = now - CACHE_TTL.LATEST_SPARK
  for (const [key, data] of latestSparkCache.entries()) {
    if (data.timestamp < latestSparkCutoff) {
      latestSparkCache.delete(key)
    }
  }

  // Clean widget tokens
  const widgetTokenCutoff = now - CACHE_TTL.WIDGET_TOKEN
  for (const [key, data] of pendingWidgetTokens.entries()) {
    if (data.timestamp < widgetTokenCutoff) {
      pendingWidgetTokens.delete(key)
    }
  }
}

/**
 * Associate a spark with pending widget tokens
 * Called when a spark is created to link it with waiting widgets
 */
export function associateSparkWithWidgetTokens(sparkId: string, userId?: string): void {
  const recentCutoff = Date.now() - CACHE_TTL.RECENT_SPARK_ASSOCIATION

  for (const [token, data] of pendingWidgetTokens.entries()) {
    // Associate with user's tokens
    if (userId && data.userId === userId && !data.sparkId) {
      data.sparkId = sparkId
      logger.debug('Associated widget token with spark', {
        token: token.slice(0, 8) + '...',
        sparkId: sparkId.slice(0, 8) + '...',
      })
    }
    // Also associate with very recent tokens (regardless of user)
    // This handles the case where resources/read had no auth
    else if (!data.sparkId && data.timestamp > recentCutoff) {
      data.sparkId = sparkId
      logger.debug('Associated recent widget token with spark', {
        token: token.slice(0, 8) + '...',
        sparkId: sparkId.slice(0, 8) + '...',
      })
    }
  }
}
