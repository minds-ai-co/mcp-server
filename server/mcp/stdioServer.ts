/**
 * Minds AI MCP Server - stdio-compatible version
 *
 * This is a variant of the main server that works with external API URLs
 * for use with stdio transport (Claude Desktop, Cursor, etc.)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

// Utilities
import { generateUserDiscoveryToken } from './utils/tokens'
import { validateOAuthToken } from './utils/apiClient'

// Tools
import { listSparksTool } from './tools/listSparks'
import { createSparkTool } from './tools/createSpark'
import { chatWithSparkTool } from './tools/chatWithSpark'
import { getSparkStatusTool } from './tools/getSparkStatus'

// Resources
import { sparkWidgetResource } from './resources/sparkWidget'

// Types
import type { McpServerContext } from './types'

// Simple logger for stdio (logs to stderr)
const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => {
    if (process.env.DEBUG) {
      console.error(`[MCP:DEBUG] ${msg}`, ctx ? JSON.stringify(ctx) : '')
    }
  },
  info: (msg: string, ctx?: Record<string, unknown>) => {
    console.error(`[MCP:INFO] ${msg}`, ctx ? JSON.stringify(ctx) : '')
  },
  warn: (msg: string, ctx?: Record<string, unknown>) => {
    console.error(`[MCP:WARN] ${msg}`, ctx ? JSON.stringify(ctx) : '')
  },
  error: (msg: string, err?: unknown, ctx?: Record<string, unknown>) => {
    console.error(`[MCP:ERROR] ${msg}`, err, ctx ? JSON.stringify(ctx) : '')
  },
}

// Token cache for stdio mode
const tokenCache = new Map<string, { userId: string; timestamp: number }>()
const TOKEN_CACHE_TTL = 60 * 1000 // 1 minute

/**
 * Create MCP server for stdio transport
 */
export function createStdioServer(apiBaseUrl: string, authToken: string) {
  const server = new McpServer({
    name: 'mindsai-personas',
    version: '1.0.0',
    description: 'Create AI personas, digital twins, and expert advisors. Train AI on people, topics, or websites. Chat with your custom AI experts.',
  })

  const apiKey = authToken
  const publicBaseUrl = apiBaseUrl

  // Track the latest spark created by this user session
  let latestSparkId: string | null = null
  let latestSparkCreatedAt: number = 0

  // User discovery token state
  let userDiscoveryToken: string | null = null
  let authenticatedUserId: string | null = null
  let tokenInitPromise: Promise<void> | null = null

  /**
   * Initialize user discovery token from API key
   */
  async function initUserDiscoveryToken() {
    if (!apiKey || userDiscoveryToken) return

    try {
      // Check local cache first
      const cached = tokenCache.get(apiKey)
      if (cached && Date.now() - cached.timestamp < TOKEN_CACHE_TTL) {
        authenticatedUserId = cached.userId
        userDiscoveryToken = generateUserDiscoveryToken(cached.userId)
        logger.debug('Using cached userId', { userId: cached.userId.slice(0, 8) + '...' })
        return
      }

      // Validate the API key to get user ID (pass external API URL)
      const userId = await validateOAuthToken(apiKey, apiBaseUrl)
      if (userId) {
        authenticatedUserId = userId
        userDiscoveryToken = generateUserDiscoveryToken(userId)
        tokenCache.set(apiKey, { userId, timestamp: Date.now() })
        logger.debug('Validated API key', { userId: userId.slice(0, 8) + '...' })
      }
    } catch (err) {
      logger.warn('Failed to init user discovery token', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  // Initialize token validation
  tokenInitPromise = initUserDiscoveryToken()

  /**
   * Ensure token is ready before resource handlers
   */
  async function ensureTokenReady() {
    if (tokenInitPromise) {
      await tokenInitPromise
    }
    if (apiKey && !authenticatedUserId) {
      const cached = tokenCache.get(apiKey)
      if (cached) {
        authenticatedUserId = cached.userId
        userDiscoveryToken = generateUserDiscoveryToken(cached.userId)
      }
    }
  }

  /**
   * Create context for tool handlers
   * Includes apiBaseUrl for external API calls
   */
  function getContext(): McpServerContext {
    return {
      publicBaseUrl,
      apiKey,
      authenticatedUserId,
      userDiscoveryToken,
      latestSparkId,
      latestSparkCreatedAt,
      apiBaseUrl, // Pass the external API URL for tools
      setLatestSpark: (sparkId: string) => {
        latestSparkId = sparkId
        latestSparkCreatedAt = Date.now()
        logger.debug('Stored latestSparkId', { sparkId: latestSparkId.slice(0, 8) + '...' })
      }
    }
  }

  // ============================================
  // Register Resources
  // ============================================

  server.registerResource(
    sparkWidgetResource.name,
    sparkWidgetResource.uri,
    sparkWidgetResource.metadata,
    async () => {
      await ensureTokenReady()
      return sparkWidgetResource.handler({
        publicBaseUrl,
        apiKey,
        authenticatedUserId,
        userDiscoveryToken,
        latestSparkId,
        latestSparkCreatedAt
      })
    }
  )

  // ============================================
  // Register Tools
  // ============================================

  server.registerTool(
    listSparksTool.name,
    listSparksTool.config,
    async (args) => listSparksTool.handler(args as any, getContext())
  )

  server.registerTool(
    createSparkTool.name,
    createSparkTool.config,
    async (args) => {
      await ensureTokenReady()
      return createSparkTool.handler(args as any, getContext())
    }
  )

  server.registerTool(
    chatWithSparkTool.name,
    chatWithSparkTool.config,
    async (args) => chatWithSparkTool.handler(args as any, getContext())
  )

  server.registerTool(
    getSparkStatusTool.name,
    getSparkStatusTool.config,
    async (args) => getSparkStatusTool.handler(args as any, getContext())
  )

  return server
}
