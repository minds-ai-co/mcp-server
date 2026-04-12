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

  const cspString = [
    "default-src 'self'",
    "script-src 'unsafe-inline' 'unsafe-eval' https://unpkg.com",
    "style-src 'unsafe-inline'",
    `connect-src ${publicBaseUrl} https://getminds.ai https://*.getminds.ai https://*.ondigitalocean.app https://*.supabase.co data: blob:`,
    `img-src ${publicBaseUrl} https://getminds.ai https://*.getminds.ai https://*.ondigitalocean.app https://*.supabase.co data: blob:`,
    `font-src ${publicBaseUrl} https://getminds.ai https://fonts.googleapis.com https://fonts.gstatic.com data:`,
  ].join('; ')

  return {
    ui: {
      csp: {
        connectDomains: [publicBaseUrl, 'https://getminds.ai', 'https://*.getminds.ai', 'https://*.ondigitalocean.app', 'https://*.supabase.co'],
        resourceDomains: [publicBaseUrl, 'https://getminds.ai', 'https://*.getminds.ai', 'https://*.ondigitalocean.app', 'https://*.supabase.co', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://unpkg.com'],
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
      connect_domains: [publicBaseUrl, 'https://getminds.ai', 'https://*.getminds.ai', 'https://*.ondigitalocean.app', 'https://*.supabase.co'],
      resource_domains: [publicBaseUrl, 'https://getminds.ai', 'https://*.getminds.ai', 'https://*.supabase.co', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
    },
  }
}
