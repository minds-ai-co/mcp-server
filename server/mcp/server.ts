/**
 * Minds MCP Server
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
import { registerAppTool, registerAppResource } from '@modelcontextprotocol/ext-apps/server'

// Utilities
import { generateUserDiscoveryToken } from './utils/tokens'
import { tokenUserIdCache } from './utils/cache'
import { validateOAuthToken as validateOAuthTokenHttp } from './utils/apiClient'
import { validateOAuthToken as validateOAuthTokenDb } from '~/server/utils/validateOAuthToken'
import { logger, CACHE_TTL } from './config'

// Tools
import { listSparksTool } from './tools/listSparks'
import { createSparkTool } from './tools/createSpark'
import { chatWithSparkTool } from './tools/chatWithSpark'
import { getSparkStatusTool } from './tools/getSparkStatus'
import { createPanelTool } from './tools/createPanel'
import { askPanelTool } from './tools/askPanel'
import { exportPanelTool } from './tools/exportPanel'
import { listPanelsTool } from './tools/listPanels'
import { getPanelStatusTool } from './tools/getPanelStatus'
import { listGroupsTool } from './tools/listGroups'
import { createGroupTool } from './tools/createGroup'
import { getPanelAnalyticsTool } from './tools/getPanelAnalytics'

// Resources
import { sparkWidgetResource } from './resources/sparkWidget'
import { responseWidgetResource } from './resources/responseWidget'

// Types
import type { McpServerContext, CreateMindsServerOptions } from './types'

/**
 * Tracks whether the last tool invocation on a server returned isError.
 * Used by the route handler to emit correct audit events (toolSuccess vs toolFailure).
 */
export const serverLastToolError = new WeakMap<object, boolean>()

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
 * Tool definitions with their registration metadata
 */
const allTools = [
  { tool: listSparksTool, needsToken: false },
  { tool: createSparkTool, needsToken: true },
  { tool: chatWithSparkTool, needsToken: false },
  { tool: getSparkStatusTool, needsToken: false },
  { tool: createPanelTool, needsToken: true },
  { tool: askPanelTool, needsToken: true },
  { tool: exportPanelTool, needsToken: true },
  { tool: listPanelsTool, needsToken: false },
  { tool: getPanelStatusTool, needsToken: false },
  { tool: listGroupsTool, needsToken: false },
  { tool: createGroupTool, needsToken: true },
  { tool: getPanelAnalyticsTool, needsToken: false },
]

/**
 * Tools that should use ext-apps registration (registerAppTool) when useExtApps is true.
 * Other tools always use server.registerTool.
 */
// Only tools with the Response Widget use ext-apps registration
const extAppToolNames = new Set([
  'chat_with_mind',
  'ask_panel',
  'get_panel_status',
])

/**
 * Create and configure the Minds MCP server
 */
export function createMindsServer(options: CreateMindsServerOptions = {}) {
  const {
    publicBaseUrl = 'https://getminds.ai',
    authToken = '',
    apiBaseUrl,
    useExtApps = true,
  } = options

  // `minds-ai` is the SDK server identity returned by JSON-RPC `initialize`
  // on the main Nuxt app at getminds.ai/mcp. There are THREE distinct MCP
  // server identities in this codebase:
  //   1. `minds-ai`        — this one, SDK-driven (what Claude Desktop /
  //                          ChatGPT / Cursor see after `initialize`)
  //   2. `mindsai-mcp`     — the GET /mcp health JSON in server/routes/mcp.ts
  //   3. `mindsai-personas` — the standalone marketplace build in
  //                          server/mcp/main.ts, synced to the separate
  //                          mcp-server repo for Dedalus Labs
  // Do not unify the three names without updating every deployment target.
  const serverOptions: Record<string, unknown> = {
    name: 'minds-ai',
    version: '2.0.0',
    description: 'Minds — synthetic market research. Create Minds (AI experts, consumer personas, digital twins), organize them into groups, run panel surveys, analyze results, and export branded reports.',
  }

  // Only include OAuth discovery metadata for ext-apps (HTTP transport)
  if (useExtApps) {
    serverOptions._meta = {
      'mcp/authorization': {
        type: 'oauth2',
        discoveryUrl: `${publicBaseUrl}/.well-known/oauth-protected-resource`,
      },
    }
  }

  const server = new McpServer(serverOptions as any)

  // Store auth token for use in tool calls
  const apiKey = authToken

  // Track the latest spark created by this user session
  let latestSparkId: string | null = null
  let latestSparkCreatedAt: number = 0

  // Track the latest panel question for widget rendering
  let latestPanelId: string | null = null
  let latestOutputData: any = null

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

      // Validate the auth token to get user ID
      // API keys (minds_/aox_) need HTTP validation via /api/v1/auth/me
      // OAuth tokens can use direct DB validation when running in-process
      const isApiKey = apiKey.startsWith('minds_') || apiKey.startsWith('aox_')
      let userId: string | null = null
      if (apiBaseUrl) {
        userId = await validateOAuthTokenHttp(apiKey, apiBaseUrl)
      } else if (isApiKey) {
        // API keys require HTTP validation (DB validator only handles OAuth tokens)
        userId = await validateOAuthTokenHttp(apiKey)
      } else {
        const result = await validateOAuthTokenDb(apiKey)
        userId = result?.userId ?? null
      }
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
      latestPanelId,
      latestOutputData,
      ...(apiBaseUrl ? { apiBaseUrl } : {}),
      setLatestSpark: (sparkId: string) => {
        latestSparkId = sparkId
        latestSparkCreatedAt = Date.now()
        logger.debug('Stored latestSparkId for widget', { sparkId: latestSparkId.slice(0, 8) + '...' })
      },
      setLatestPanel: (panelId: string, outputData?: any) => {
        latestPanelId = panelId
        if (outputData) latestOutputData = outputData
        logger.debug('Stored latestPanelId for widget', { panelId: panelId.slice(0, 8) + '...' })
      },
    }
  }

  // ============================================
  // Register Resources
  // ============================================

  const resourceRegistrar = useExtApps
    ? (name: string, uri: string, metadata: any, handler: any) => registerAppResource(server, name, uri, metadata, handler)
    : (name: string, uri: string, metadata: any, handler: any) => server.registerResource(name, uri, metadata, handler)

  // Legacy spark widget (kept for backward compat with existing ChatGPT installs)
  resourceRegistrar(
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

  // Response widget — the only widget using shared/ui components
  resourceRegistrar(
    responseWidgetResource.name,
    responseWidgetResource.uri,
    responseWidgetResource.metadata,
    async () => {
      await ensureTokenReady()
      return responseWidgetResource.handler(getContext())
    }
  )

  // Creation and Info widgets disabled — these tools return rich text content
  // that LLMs present directly. No custom widget UI needed.

  // ============================================
  // Register Tools
  // ============================================

  for (const { tool, needsToken } of allTools) {
    const useExtApp = useExtApps && extAppToolNames.has(tool.name)
    const register = useExtApp
      ? (name: string, config: any, handler: any) => registerAppTool(server, name, config, handler)
      : (name: string, config: any, handler: any) => server.registerTool(name, config, handler)

    const wrappedHandler = async (args: any) => {
      if (needsToken) await ensureTokenReady()
      const result = await tool.handler(args as any, getContext())
      serverLastToolError.set(server, result?.isError === true)
      return result
    }

    register(tool.name, tool.config, wrappedHandler)
  }

  return server
}

export type MindsServer = ReturnType<typeof createMindsServer>
