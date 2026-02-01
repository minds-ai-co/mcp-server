/**
 * Minds AI MCP Server
 * Main server creation and configuration
 *
 * Create and chat with AI personas, digital twins, and expert advisors.
 *
 * Key capabilities:
 * - Create AI versions of people (digital twins, clones)
 * - Build AI experts in any field (marketing, legal, coaching, etc.)
 * - Train AI on website content or documentation
 * - Have conversations with your AI personas
 *
 * Compatible with ChatGPT Apps SDK, Claude Desktop, Cursor, and other MCP clients.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

// Utilities
import { generateUserDiscoveryToken } from './utils/tokens'
import { tokenUserIdCache } from './utils/cache'
import { validateOAuthToken } from './utils/apiClient'
import { logger, CACHE_TTL } from './config'

// Tools
import { listSparksTool } from './tools/listSparks'
import { createSparkTool } from './tools/createSpark'
import { chatWithSparkTool } from './tools/chatWithSpark'
import { getSparkStatusTool } from './tools/getSparkStatus'

// Resources
import { sparkWidgetResource } from './resources/sparkWidget'

// Types
import type { McpServerContext } from './types'

/**
 * Server capabilities declaration
 * Advertises what features this server supports
 */
export const SERVER_CAPABILITIES = {
  /** Server supports tool execution */
  tools: {
    /** Server can list available tools */
    listChanged: false,
  },
  /** Server supports resources */
  resources: {
    /** Server can subscribe to resource updates */
    subscribe: false,
    /** Server can list resource changes */
    listChanged: false,
  },
  /** Server supports prompts */
  prompts: {
    /** Server can list prompt changes */
    listChanged: false,
  },
  /** Server supports logging */
  logging: {},
} as const

/**
 * Create and configure the Minds AI MCP server
 */
export function createArtOfXServer(publicBaseUrl: string = 'https://getminds.ai', authToken: string = '') {
  const server = new McpServer({
    name: 'mindsai-personas',
    version: '1.0.0',
    description: 'Create AI personas, digital twins, and expert advisors. Train AI on people, topics, or websites. Chat with your custom AI experts.',
    _meta: {
      'mcp/authorization': {
        type: 'oauth2',
        discoveryUrl: `${publicBaseUrl}/.well-known/oauth-protected-resource`,
      },
    },
  })

  // Store auth token for use in tool calls
  const apiKey = authToken

  // Track the latest spark created by this user session
  let latestSparkId: string | null = null
  let latestSparkCreatedAt: number = 0

  // User discovery token state
  let userDiscoveryToken: string | null = null
  let authenticatedUserId: string | null = null
  let tokenInitPromise: Promise<void> | null = null

  /**
   * Initialize user discovery token from OAuth token
   */
  async function initUserDiscoveryToken() {
    if (!apiKey || userDiscoveryToken) return

    try {
      // Check module-level cache first
      const cached = tokenUserIdCache.get(apiKey)
      if (cached && Date.now() - cached.timestamp < CACHE_TTL.TOKEN_VALIDATION) {
        authenticatedUserId = cached.userId
        userDiscoveryToken = generateUserDiscoveryToken(cached.userId)
        logger.debug('Using cached userId', { userId: cached.userId.slice(0, 8) + '...' })
        return
      }

      // Validate the OAuth token to get user ID
      const userId = await validateOAuthToken(apiKey)
      if (userId) {
        authenticatedUserId = userId
        userDiscoveryToken = generateUserDiscoveryToken(userId)
        tokenUserIdCache.set(apiKey, { userId, timestamp: Date.now() })
        logger.debug('Generated user discovery token', { userId: userId.slice(0, 8) + '...' })
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
    // Extra check: if we have apiKey but no userId yet, try cache
    if (apiKey && !authenticatedUserId) {
      const cached = tokenUserIdCache.get(apiKey)
      if (cached) {
        authenticatedUserId = cached.userId
        userDiscoveryToken = generateUserDiscoveryToken(cached.userId)
        logger.debug('Late-loaded userId from cache', { userId: cached.userId.slice(0, 8) + '...' })
      }
    }
  }

  /**
   * Create context for tool handlers
   */
  function getContext(): McpServerContext {
    return {
      publicBaseUrl,
      apiKey,
      authenticatedUserId,
      userDiscoveryToken,
      latestSparkId,
      latestSparkCreatedAt,
      setLatestSpark: (sparkId: string) => {
        latestSparkId = sparkId
        latestSparkCreatedAt = Date.now()
        logger.debug('Stored latestSparkId for widget', { sparkId: latestSparkId.slice(0, 8) + '...' })
      }
    }
  }

  // ============================================
  // Register Resources
  // ============================================

  // Unified Spark Widget (supports both creation and chat modes)
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

export type ArtOfXServer = ReturnType<typeof createArtOfXServer>
