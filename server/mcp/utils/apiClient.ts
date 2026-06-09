/**
 * API client utilities for MCP server
 * Handles authenticated requests to internal API with timeouts and circuit breaker
 */

import { API_BASE_URL, logger, POLLING_CONFIG, TIMEOUT_CONFIG, CIRCUIT_BREAKER_CONFIG } from '../config'
import { withCircuitBreaker, CircuitBreakerOpenError } from './circuitBreaker'
import { timeout as timeoutError, serviceUnavailable } from './errors'

/**
 * Error thrown by apiCall/publicApiCall that preserves HTTP status and structured response data.
 * Nuxt's createError uses `statusMessage` (not `message`) and puts structured info in `data`.
 */
export class ApiError extends Error {
  readonly status: number
  readonly data?: Record<string, unknown>

  constructor(
    message: string,
    status: number,
    data?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

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
      throw new Error('Authentication required. Please configure your Minds API key in ChatGPT settings.')
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
            const body = await response.json().catch(() => ({}))
            const message = body.statusMessage || body.message || `API error: ${response.status}`
            if (response.status === 401 || response.status === 403) {
              logger.warn('[apiClient] Auth rejected by internal API', {
                endpoint,
                status: response.status,
                tokenPrefix: authToken ? authToken.slice(0, 8) + '...' : 'none',
                errorMessage: message,
              })
            }
            throw new ApiError(message, response.status, body.data)
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
            const body = await response.json().catch(() => ({}))
            const message = body.statusMessage || body.message || `API error: ${response.status}`
            throw new ApiError(message, response.status, body.data)
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
 * Supports both OAuth tokens and API keys (prefixed with 'minds_' or legacy 'aox_')
 */
export async function validateOAuthToken(token: string, apiBaseUrl?: string): Promise<string | null> {
  const baseUrl = apiBaseUrl || API_BASE_URL
  const isApiKey = token.startsWith('minds_') || token.startsWith('aox_')
  const timeoutMs = isApiKey
    ? TIMEOUT_CONFIG.TOKEN_VALIDATION_TIMEOUT
    : TIMEOUT_CONFIG.POLLING_TIMEOUT

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
  /** Authoritative readiness (MIN-48): a mind is usable only when this is true. */
  readyToChat?: boolean
  progress: number
  message: string
  knowledge?: unknown[]
  knowledgeItemCount?: number
  spark?: SparkData | null
  systemPrompt?: string
  /**
   * Last real training stage observed before an upstream timeout
   * (e.g. 'running', 'collecting sources'). Lets get_mind_status report a
   * useful stage instead of the generic "timeout" string on timeout.
   */
  lastKnownStatus?: string
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
  apiBaseUrl?: string,
  authToken?: string,
  requestTimeout?: number
): Promise<SparkStatusResult> {
  const baseUrl = apiBaseUrl || API_BASE_URL
  const timeoutMs = requestTimeout || TIMEOUT_CONFIG.POLLING_TIMEOUT
  let lastSpark: SparkData | null = null
  let lastSystemPrompt: string = ''
  let lastStatus: string | undefined

  const fetchJson = async (path: string) => {
    const { controller, timeoutId } = createTimeoutController(timeoutMs)
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        signal: controller.signal,
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      clearTimeout(timeoutId)
      return res
    } catch (err) {
      clearTimeout(timeoutId)
      throw err
    }
  }

  for (let i = 0; i < maxAttempts; i++) {
    try {
      // MIN-48: readiness comes from the authoritative v1 training endpoint
      // (`readyToChat`, no `idle`, no progress %), with the v1 spark detail
      // supplying the display fields + knowledgeItemCount. Demo / ephemeral
      // minds are owned by the demo-flow account, so the API key caller gets
      // 403/404 from v1 — for those we fall back to the public demo-state
      // endpoint (which grants demo-session / public access) and map its
      // pipeline status onto readyToChat (`completed` === ready).
      // NOTE: these MUST be the `/api/v1/...` Nuxt routes, not the bare
      // `/v1/...` namespace. Bare `/v1/*` is served ONLY on the api.getminds.ai
      // subdomain, but the MCP server calls itself via its app base
      // (localhost:3000 / the getminds.ai app host), which serves `/api/v1/*`.
      // Calling `/v1/...` here returned the SPA HTML, `.json()` threw, the error
      // was swallowed, and get_mind_status fell back to its "running / 0% / still
      // training" timeout response for every Mind — even ready ones (MIN-114).
      const [trainingRes, sparkRes] = await Promise.all([
        fetchJson(`/api/v1/sparks/${sparkId}/training`),
        fetchJson(`/api/v1/sparks/${sparkId}`),
      ])

      if (trainingRes.ok) {
        const training = await trainingRes.json()
        const status: string = training.status || 'running'
        lastStatus = status
        const readyToChat: boolean = training.readyToChat === true
        const message: string = training.message || (readyToChat ? 'Ready to chat!' : 'Training in progress...')

        // Spark display object is best-effort — status above is authoritative.
        let spark: SparkData | null = lastSpark
        let knowledgeItemCount = 0
        if (sparkRes.ok) {
          const sparkBody = await sparkRes.json().catch(() => ({}))
          const d = sparkBody?.data
          if (d) {
            spark = {
              id: d.id,
              name: d.name,
              description: d.description,
              type: d.type,
              discipline: d.discipline,
              profileImageUrl: d.profileImageUrl,
              systemPrompt: d.systemPrompt,
            }
            knowledgeItemCount = d.knowledgeItemCount || 0
            lastSpark = spark
            if (d.systemPrompt) lastSystemPrompt = d.systemPrompt
          }
        }

        logger.debug('Spark status poll', { sparkId: sparkId.slice(0, 8) + '...', status, readyToChat })

        const terminal = readyToChat || status === 'completed' || status === 'failed'
        if (terminal || !waitForCompletion) {
          return { status, readyToChat, progress: readyToChat ? 100 : 0, message, knowledge: [], knowledgeItemCount, spark, systemPrompt: lastSystemPrompt }
        }
        await new Promise(resolve => setTimeout(resolve, POLLING_CONFIG.POLL_INTERVAL_MS))
        continue
      }

      // Bad credentials are terminal regardless of which surface owns the mind.
      if (trainingRes.status === 401) {
        return { status: 'error', readyToChat: false, progress: 0, message: 'Access denied: invalid API key' }
      }

      // 403/404/other from v1 → try the public demo-state endpoint (demo/public).
      const demoRes = await fetchJson(`/api/public/spark/${sparkId}/demo-state?_t=${Date.now()}`)
      if (demoRes.ok) {
        const data = await demoRes.json()
        const status: string = data.collectionStatus?.status || 'running'
        lastStatus = status
        const readyToChat = status === 'completed'
        const progress = readyToChat ? 100 : (data.collectionStatus?.progress || 0)
        const message = data.collectionStatus?.message || 'Processing...'
        const knowledge = data.portfolioItems || []
        const spark: SparkData | null = data.spark || lastSpark
        if (spark) lastSpark = spark
        if (spark?.systemPrompt) lastSystemPrompt = spark.systemPrompt

        logger.debug('Spark status poll (demo-state)', { sparkId: sparkId.slice(0, 8) + '...', status, readyToChat })

        const terminal = readyToChat || status === 'failed'
        if (terminal || !waitForCompletion) {
          return { status, readyToChat, progress, message, knowledge, knowledgeItemCount: knowledge.length, spark, systemPrompt: lastSystemPrompt }
        }
        await new Promise(resolve => setTimeout(resolve, POLLING_CONFIG.POLL_INTERVAL_MS))
        continue
      }

      const errBody = await demoRes.json().catch(() => ({}))
      const errorMsg = errBody.statusMessage || errBody.message || `HTTP ${demoRes.status}`
      logger.warn('Spark status poll failed', { sparkId: sparkId.slice(0, 8) + '...', status: demoRes.status, error: errorMsg })
      if (demoRes.status === 403 || demoRes.status === 401) {
        return { status: 'error', readyToChat: false, progress: 0, message: `Access denied: ${errorMsg}` }
      }
      if (demoRes.status === 404) {
        return { status: 'error', readyToChat: false, progress: 0, message: 'Spark not found' }
      }
      // Other errors: continue polling if attempts remain.
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
    readyToChat: false,
    progress: lastSpark ? -1 : 0,
    message: 'Status check timed out. Use get_mind_status to retry.',
    knowledge: [],
    spark: lastSpark,
    systemPrompt: lastSystemPrompt,
    lastKnownStatus: lastStatus,
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
