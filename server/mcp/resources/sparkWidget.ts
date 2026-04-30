/**
 * Spark Widget Resource
 * Unified widget for AI persona creation and chat interactions
 *
 * Modes:
 * - Creation mode: Shows real-time progress during spark creation
 * - Chat mode: Shows chat interface with an existing spark and optional initial message
 */

import { randomBytes } from 'crypto'
import { loadSparkWidget } from './widgetLoader'
import { latestSparkCache, pendingWidgetTokens, cleanupCaches } from '../utils/cache'
import { CACHE_TTL, logger } from '../config'

/**
 * Build widget metadata with CSP domains based on the server's public URL.
 * The CSP must include whatever domain the widget will call for API requests.
 */
function buildWidgetMeta(publicBaseUrl: string) {
  // Derive a stable HTTPS origin for _meta.ui.domain. Required for ChatGPT app
  // submission; must be unique per app. See Apps SDK reference.
  let widgetOrigin = 'https://getminds.ai'
  try {
    const u = new URL(publicBaseUrl)
    widgetOrigin = `${u.protocol}//${u.host}`
  } catch { /* fallback to getminds.ai default */ }

  // Raw CSP string — ChatGPT enforces this on the widget iframe
  const cspString = [
    "default-src 'self'",
    "script-src 'unsafe-inline' 'unsafe-eval'",
    "style-src 'unsafe-inline'",
    `connect-src ${publicBaseUrl} https://getminds.ai https://*.getminds.ai https://*.ondigitalocean.app https://*.supabase.co data: blob:`,
    `img-src ${publicBaseUrl} https://getminds.ai https://*.getminds.ai https://*.ondigitalocean.app https://*.supabase.co data: blob:`,
    `font-src ${publicBaseUrl} https://getminds.ai https://fonts.googleapis.com https://fonts.gstatic.com data:`,
  ].join('; ')

  return {
    // MCP Apps standard structured CSP (Claude, VS Code, Goose)
    ui: {
      csp: {
        connectDomains: [
          publicBaseUrl,
          'https://getminds.ai',
          'https://*.getminds.ai',
          'https://*.ondigitalocean.app',
          'https://*.supabase.co',
        ],
        resourceDomains: [
          publicBaseUrl,
          'https://getminds.ai',
          'https://*.getminds.ai',
          'https://*.ondigitalocean.app',
          'https://*.supabase.co',
          'https://fonts.googleapis.com',
          'https://fonts.gstatic.com',
        ],
      },
      domain: widgetOrigin,
      prefersBorder: true,
      height: 600,
    },
    // OpenAI Apps SDK raw CSP string (ChatGPT reads this)
    'openai/widgetPrefersBorder': true,
    'openai/widgetHeight': 600,
    'openai/widgetDomain': widgetOrigin,
    'openai/widgetCsp': cspString,
  }
}

export interface SparkWidgetContext {
  publicBaseUrl: string
  apiKey: string
  authenticatedUserId: string | null
  userDiscoveryToken: string | null
  latestSparkId: string | null
  latestSparkCreatedAt: number
  // Chat mode options
  mode?: 'create' | 'chat'
  sparkId?: string
  initialMessage?: string
  initialResponse?: string
  sparkData?: {
    id: string
    name: string
    type?: string
    discipline?: string
    profileImageUrl?: string
  }
}

export const sparkWidgetResource = {
  name: 'ai-persona-widget',
  uri: 'ui://widget/spark.html',
  metadata: {
    title: 'AI Persona Widget',
    description: 'Interactive widget for AI personas. Supports creation mode with real-time training progress, and chat mode for conversations with existing personas.',
  },

  handler: async (context: SparkWidgetContext) => {
    const {
      publicBaseUrl,
      apiKey,
      authenticatedUserId,
      userDiscoveryToken,
      latestSparkId,
      latestSparkCreatedAt,
      mode = 'create',
      sparkId,
      initialMessage,
      initialResponse,
      sparkData
    } = context


    try {
      let html = await loadSparkWidget(publicBaseUrl)

      // Check module-level cache for this user's latest spark
      let sparkIdToEmbed = latestSparkId
      let sparkTimestamp = latestSparkCreatedAt

      if (!sparkIdToEmbed && authenticatedUserId) {
        const cached = latestSparkCache.get(authenticatedUserId)
        if (cached && Date.now() - cached.timestamp < CACHE_TTL.LATEST_SPARK) {
          sparkIdToEmbed = cached.sparkId
          sparkTimestamp = cached.timestamp
        }
      }

      // Timestamp when widget HTML was generated - used to find sparks created AFTER this
      const widgetGeneratedAt = Date.now()

      // Build config based on mode
      let configScript = ''

      if (mode === 'chat' && sparkId) {
        // Chat mode: Show chat tab with initial message/response
        const chatConfig = {
          sparkId,
          mode: 'chat',
          initialMessage: initialMessage || '',
          initialResponse: initialResponse || '',
          sparkData: sparkData || null
        }
        configScript = `<script>
window.__WIDGET_MODE__ = "chat";
window.__SPARK_ID__ = "${sparkId}";
window.__INITIAL_MESSAGE__ = ${JSON.stringify(initialMessage || '')};
window.__INITIAL_RESPONSE__ = ${JSON.stringify(initialResponse || '')};
window.__SPARK_DATA__ = ${JSON.stringify(sparkData || null)};
window.__API_BASE__ = "${publicBaseUrl}";
</script>`
      }
      // CREATE MODE: Embed latestSparkId if available (for the tool that just ran)
      // Also include discovery token as fallback for cached widgets
      else if (userDiscoveryToken) {
        // If latestSparkId is recent, embed it directly
        const isRecentSpark = sparkIdToEmbed && (Date.now() - sparkTimestamp < CACHE_TTL.RECENT_SPARK_ASSOCIATION)
        if (isRecentSpark) {
          logger.debug('Embedding recent spark ID in widget', { sparkId: sparkIdToEmbed?.slice(0, 8) + '...' })
          configScript = `<script>
window.__SPARK_ID__ = "${sparkIdToEmbed}";
window.__USER_DISCOVERY_TOKEN__ = "${userDiscoveryToken}";
window.__WIDGET_GENERATED_AT__ = ${widgetGeneratedAt};
window.__API_BASE__ = "${publicBaseUrl}";
</script>`
        } else {
          // No recent spark, use discovery only
          configScript = `<script>window.__USER_DISCOVERY_TOKEN__ = "${userDiscoveryToken}"; window.__WIDGET_GENERATED_AT__ = ${widgetGeneratedAt}; window.__API_BASE__ = "${publicBaseUrl}";</script>`
        }
      }
      // Fallback: No discovery token — still embed latestSparkId if recent
      else {
        const isRecentSpark = sparkIdToEmbed && (Date.now() - sparkTimestamp < CACHE_TTL.RECENT_SPARK_ASSOCIATION)
        const widgetToken = randomBytes(16).toString('hex')
        pendingWidgetTokens.set(widgetToken, { timestamp: widgetGeneratedAt, userId: authenticatedUserId || undefined })
        cleanupCaches()
        if (isRecentSpark) {
          logger.debug('Embedding recent spark ID in widget (no discovery token)', { sparkId: sparkIdToEmbed?.slice(0, 8) + '...' })
          configScript = `<script>
window.__SPARK_ID__ = "${sparkIdToEmbed}";
window.__WIDGET_TOKEN__ = "${widgetToken}";
window.__WIDGET_GENERATED_AT__ = ${widgetGeneratedAt};
window.__API_BASE__ = "${publicBaseUrl}";
</script>`
        } else {
          configScript = `<script>window.__WIDGET_TOKEN__ = "${widgetToken}"; window.__WIDGET_GENERATED_AT__ = ${widgetGeneratedAt}; window.__API_BASE__ = "${publicBaseUrl}";</script>`
        }
      }

      html = html.replace('<div id="app"></div>', `${configScript}<div id="app"></div>`)

      const meta = buildWidgetMeta(publicBaseUrl)

      return {
        contents: [
          {
            uri: 'ui://widget/spark.html',
            mimeType: 'text/html;profile=mcp-app',
            text: html,
            _meta: meta,
          },
        ],
      }
    } catch (error) {
      logger.error('Error loading spark widget resource', error)
      const meta = buildWidgetMeta(publicBaseUrl)
      return {
        contents: [
          {
            uri: 'ui://widget/spark.html',
            mimeType: 'text/html;profile=mcp-app',
            text: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Minds - Spark</title></head><body style="font-family:system-ui;padding:20px;background:#0a0a0b;color:#fff;"><p>Minds Spark Widget</p></body></html>`,
            _meta: meta,
          },
        ],
      }
    }
  }
}
