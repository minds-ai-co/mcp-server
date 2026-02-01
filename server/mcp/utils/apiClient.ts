/**
 * API client utilities for MCP server
 * Handles authenticated requests to internal API with timeouts and circuit breaker
 */

import { API_BASE_URL, logger, POLLING_CONFIG, TIMEOUT_CONFIG, CIRCUIT_BREAKER_CONFIG } from '../config'
import { withCircuitBreaker, CircuitBreakerOpenError } from './circuitBreaker'
import { timeout as timeoutError, serviceUnavailable } from './errors'

export interface ApiClientConfig {
  authToken?: string
  /** Default timeout for requests in ms */
  timeout?: number
  /** Optional base URL override (for stdio transport with external API) */
  apiBaseUrl?: string
}

/**
 * Create an AbortController with timeout
 */
function createTimeoutController(timeoutMs: number): { controller: AbortController; timeoutId: NodeJS.Timeout } {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  return { controller, timeoutId }
}

/**
 * Create an API client for making authenticated requests
 */
export function createApiClient(config: ApiClientConfig) {
  const { authToken, timeout: defaultTimeout = TIMEOUT_CONFIG.DEFAULT_API_TIMEOUT, apiBaseUrl } = config
  const baseUrl = apiBaseUrl || API_BASE_URL

  /**
   * Make an authenticated API call with timeout and circuit breaker
   * @throws Error if request fails
   */
  async function apiCall<T = any>(
    endpoint: string,
    options: RequestInit & { timeout?: number } = {}
  ): Promise<T> {
    if (!authToken) {
      throw new Error('Authentication required. Please configure your Minds AI API key in ChatGPT settings.')
    }

    const url = `${baseUrl}${endpoint}`
    const timeoutMs = options.timeout || defaultTimeout

    return withCircuitBreaker<T>(
      'internal-api',
      async () => {
        const { controller, timeoutId } = createTimeoutController(timeoutMs)

        try {
          const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
              'Authorization': `Bearer ${authToken}`,
              'Content-Type': 'application/json',
              ...options.headers,
            },
          })

          clearTimeout(timeoutId)

          if (!response.ok) {
            const error = await response.json().catch(() => ({ message: response.statusText }))
            throw new Error(error.message || `API error: ${response.status}`)
          }

          return response.json()
        } catch (err) {
          clearTimeout(timeoutId)

          if (err instanceof Error && err.name === 'AbortError') {
            throw timeoutError(endpoint, timeoutMs)
          }

          throw err
        }
      },
      {
        config: CIRCUIT_BREAKER_CONFIG,
        fallback: () => {
          throw serviceUnavailable('Internal API')
        },
      }
    )
  }

  /**
   * Make an unauthenticated API call (for public endpoints)
   */
  async function publicApiCall<T = any>(
    endpoint: string,
    options: RequestInit & { timeout?: number } = {}
  ): Promise<T> {
    const url = `${baseUrl}${endpoint}`
    const timeoutMs = options.timeout || defaultTimeout

    return withCircuitBreaker<T>(
      'public-api',
      async () => {
        const { controller, timeoutId } = createTimeoutController(timeoutMs)

        try {
          const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              ...options.headers,
            },
          })

          clearTimeout(timeoutId)

          if (!response.ok) {
            const error = await response.json().catch(() => ({ message: response.statusText }))
            throw new Error(error.message || `API error: ${response.status}`)
          }

          return response.json()
        } catch (err) {
          clearTimeout(timeoutId)

          if (err instanceof Error && err.name === 'AbortError') {
            throw timeoutError(endpoint, timeoutMs)
          }

          throw err
        }
      },
      {
        config: CIRCUIT_BREAKER_CONFIG,
      }
    )
  }

  return {
    apiCall,
    publicApiCall,
  }
}

/**
 * Validate an auth token (OAuth token or API key) and get the associated user ID
 * Supports both OAuth tokens and API keys (prefixed with 'aox_')
 */
export async function validateOAuthToken(token: string, apiBaseUrl?: string): Promise<string | null> {
  const baseUrl = apiBaseUrl || API_BASE_URL
  const timeoutMs = TIMEOUT_CONFIG.POLLING_TIMEOUT
  const isApiKey = token.startsWith('aox_')

  try {
    const { controller, timeoutId } = createTimeoutController(timeoutMs)

    // For API keys, validate via the v1 API which handles both auth types
    // For OAuth tokens, use the dedicated validation endpoint
    const endpoint = isApiKey
      ? `${baseUrl}/api/v1/auth/me`
      : `${baseUrl}/api/oauth/validate-token`

    const response = await fetch(endpoint, {
      method: isApiKey ? 'GET' : 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    })

    clearTimeout(timeoutId)

    if (response.ok) {
      const data = await response.json()
      // API key endpoint returns user object, OAuth returns { userId }
      return data.userId || data.id || null
    }
    return null
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn('Token validation timed out', { isApiKey })
      return null
    }
    logger.warn('Failed to validate token', {
      isApiKey,
      error: err instanceof Error ? err.message : String(err)
    })
    return null
  }
}

/** Result of polling spark status */
export interface SparkStatusResult {
  status: string
  progress: number
  message: string
  knowledge?: unknown[]
  spark?: SparkData | null
  systemPrompt?: string
}

/** Spark data from status poll */
export interface SparkData {
  id: string
  name: string
  description?: string
  type?: string
  discipline?: string
  profileImageUrl?: string
  systemPrompt?: string
}

/**
 * Poll for spark status until completion or timeout
 */
export async function pollSparkStatus(
  sparkId: string,
  maxAttempts: number = POLLING_CONFIG.DEFAULT_MAX_ATTEMPTS,
  waitForCompletion: boolean = false,
  apiBaseUrl?: string
): Promise<SparkStatusResult> {
  const baseUrl = apiBaseUrl || API_BASE_URL
  let lastKnowledge: unknown[] = []
  let lastSpark: SparkData | null = null
  let lastSystemPrompt: string = ''

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const { controller, timeoutId } = createTimeoutController(TIMEOUT_CONFIG.POLLING_TIMEOUT)

      const response = await fetch(
        `${baseUrl}/api/public/spark/${sparkId}/demo-state?_t=${Date.now()}`,
        { signal: controller.signal }
      )

      clearTimeout(timeoutId)

      if (response.ok) {
        const data = await response.json()
        const status = data.collectionStatus?.status || 'running'
        const progress = data.collectionStatus?.progress || 0
        const message = data.collectionStatus?.message || 'Processing...'
        const knowledge = data.portfolioItems || []
        const spark = data.spark || null
        const systemPrompt = spark?.systemPrompt || ''

        // Keep track of latest data
        if (knowledge.length > lastKnowledge.length) {
          lastKnowledge = knowledge
        }
        if (spark) lastSpark = spark
        if (systemPrompt) lastSystemPrompt = systemPrompt

        logger.debug('Spark status poll', {
          sparkId: sparkId.slice(0, 8) + '...',
          status,
          progress,
          knowledgeItems: knowledge.length,
        })

        // If completed or failed, return immediately
        if (status === 'completed' || status === 'failed' || status === 'idle') {
          return {
            status,
            progress: status === 'completed' ? 100 : progress,
            message,
            knowledge: lastKnowledge,
            spark: lastSpark,
            systemPrompt: lastSystemPrompt
          }
        }

        // If not waiting for completion, return current progress
        if (!waitForCompletion) {
          return { status, progress, message, knowledge, spark, systemPrompt }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logger.warn('Spark status poll timed out', { sparkId: sparkId.slice(0, 8) + '...' })
      } else {
        logger.warn('Failed to poll spark status', {
          sparkId: sparkId.slice(0, 8) + '...',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, POLLING_CONFIG.POLL_INTERVAL_MS))
  }

  // Timeout - return last known state
  return {
    status: 'timeout',
    progress: 0,
    message: 'Collection is still in progress. Use check_ai_persona_training_progress to monitor.',
    knowledge: lastKnowledge,
    spark: lastSpark,
    systemPrompt: lastSystemPrompt
  }
}

/**
 * Fetch with timeout helper
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const timeoutMs = options.timeout || TIMEOUT_CONFIG.DEFAULT_API_TIMEOUT
  const { controller, timeoutId } = createTimeoutController(timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    return response
  } catch (err) {
    clearTimeout(timeoutId)
    if (err instanceof Error && err.name === 'AbortError') {
      throw timeoutError(url, timeoutMs)
    }
    throw err
  }
}
