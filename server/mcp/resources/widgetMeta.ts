/**
 * Shared widget metadata builder for MCP resources.
 * Generates CSP + widget origin for MCP Apps hosts (ChatGPT, Claude, etc).
 */

export function buildWidgetMeta(publicBaseUrl: string, height: number = 500) {
  // Derive a stable HTTPS origin for _meta.ui.domain. Per the MCP Apps spec and
  // OpenAI Apps SDK reference, this must be a full "string (origin)" — a scheme
  // + host URL the developer owns. ChatGPT uses this as the uniqueness key for
  // app submission. See https://developers.openai.com/apps-sdk/reference and
  // https://developers.openai.com/apps-sdk/build/mcp-server.
  let widgetOrigin = 'https://getminds.ai'
  try {
    const u = new URL(publicBaseUrl)
    widgetOrigin = `${u.protocol}//${u.host}`
  } catch { /* fallback to getminds.ai default */ }

  // Pin Supabase to the exact project origin (no wildcard). Needed for spark
  // profile images served from `${SUPABASE_URL}/storage/v1/object/public/...`.
  let supabaseOrigin = ''
  try { supabaseOrigin = new URL(process.env.SUPABASE_URL || '').origin } catch { /* none configured */ }

  // Origins the widget may connect to / load resources from. Vue & Three are now
  // self-hosted under `${widgetOrigin}/embed/vendor/*`, so they load via 'self'
  // (script-src) and the widget origin (resource lists) — no third-party CDN.
  const connectDomains = [publicBaseUrl, 'https://getminds.ai', 'https://*.getminds.ai', supabaseOrigin].filter(Boolean)
  const resourceDomains = [...connectDomains, 'https://fonts.googleapis.com', 'https://fonts.gstatic.com']

  const cspString = [
    "default-src 'self'",
    // 'self' lets the self-hosted Vue/Three modules load; 'unsafe-inline' is for
    // the inlined bootstrap + widget bundle. No 'unsafe-eval', no unpkg.
    "script-src 'self' 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    `connect-src ${connectDomains.join(' ')} data: blob:`,
    `img-src ${connectDomains.join(' ')} data: blob:`,
    `font-src ${publicBaseUrl} https://getminds.ai https://fonts.googleapis.com https://fonts.gstatic.com data:`,
  ].join('; ')

  return {
    ui: {
      csp: {
        connectDomains,
        resourceDomains,
      },
      domain: widgetOrigin,
      prefersBorder: true,
      height,
    },
    'openai/widgetPrefersBorder': true,
    'openai/widgetHeight': height,
    'openai/widgetDomain': widgetOrigin,
    'openai/widgetCsp': cspString,
    // OpenAI object format (snake_case keys)
    'openai/widgetCSP': {
      connect_domains: connectDomains,
      resource_domains: resourceDomains,
    },
  }
}
