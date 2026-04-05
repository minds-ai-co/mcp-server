/**
 * Shared widget metadata builder for MCP resources.
 * Generates CSP configuration for both Claude (structured) and ChatGPT (raw string).
 */

import { createHash } from 'crypto'

export function buildWidgetMeta(publicBaseUrl: string, height: number = 500) {
  let cspHost = '*'
  try { cspHost = new URL(publicBaseUrl).host } catch {}

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
      domain: createHash('sha256').update(publicBaseUrl.replace(/\/$/, '') + '/mcp').digest('hex').slice(0, 32) + '.claudemcpcontent.com',
      prefersBorder: true,
      height,
    },
    'openai/widgetPrefersBorder': true,
    'openai/widgetHeight': height,
    'openai/widgetDomain': cspHost,
    'openai/widgetCsp': cspString,
  }
}
