/**
 * Load pre-built widget HTML and inject __WIDGET_CONFIG__.
 *
 * Tries multiple strategies:
 * 1. Fetch from the server's own public URL (works everywhere — Nitro serves /_widgets/)
 * 2. Read from filesystem (dev fallback)
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { logger } from '../config'

// Cache loaded HTML in memory (read once per widget)
const cache = new Map<string, string>()

const ERROR_HTML = (name: string) =>
  `<!DOCTYPE html><html><body><p style="color:#ef4444;padding:2rem">Widget "${name}" not built. Run: pnpm build:widgets</p></body></html>`

async function loadWidgetAsync(name: 'creation' | 'info' | 'response'): Promise<string> {
  if (cache.has(name)) return cache.get(name)!

  // 1. Fetch from the server's own public URL — works in all environments
  //    because Nitro always serves public/ files regardless of filesystem layout
  try {
    const port = process.env.PORT || '3000'
    const res = await fetch(`http://127.0.0.1:${port}/_widgets/${name}.html`)
    if (res.ok) {
      const html = await res.text()
      if (html.length > 200) {
        logger.info(`Loaded widget HTML via localhost fetch: ${name}`)
        cache.set(name, html)
        return html
      }
    }
  } catch (err) {
    logger.debug(`Localhost fetch failed for ${name}: ${err instanceof Error ? err.message : String(err)}`)
  }

  // 2. Fallback: read from filesystem (local dev)
  const cwd = process.cwd()
  const candidates = [
    resolve(cwd, `widgets/dist/${name}.html`),
    resolve(cwd, `public/_widgets/${name}.html`),
    resolve(cwd, `.output/public/_widgets/${name}.html`),
  ]
  for (const filePath of candidates) {
    if (existsSync(filePath)) {
      try {
        const html = readFileSync(filePath, 'utf-8')
        logger.info(`Loaded widget HTML: ${name} from ${filePath}`)
        cache.set(name, html)
        return html
      } catch (err) {
        logger.error(`Failed to read widget HTML: ${name} at ${filePath}`, { error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  logger.error(`Widget HTML not found: ${name}`, { cwd, tried: candidates })
  return ERROR_HTML(name)
}

export function getWidgetHtml(name: 'creation' | 'info' | 'response', config: Record<string, any>): string {
  if (cache.has(name)) {
    const html = cache.get(name)!
    const configScript = `<script>window.__WIDGET_CONFIG__ = ${JSON.stringify(config)};</script>`
    return html.replace('<!-- __WIDGET_CONFIG__ -->', configScript)
  }
  // Trigger async load for next call
  loadWidgetAsync(name).catch(() => {})
  return ERROR_HTML(name)
}

/**
 * Async version — awaits loading. Use this in resource handlers.
 */
export async function getWidgetHtmlAsync(name: 'creation' | 'info' | 'response', config: Record<string, any>): Promise<string> {
  const html = await loadWidgetAsync(name)
  const configScript = `<script>window.__WIDGET_CONFIG__ = ${JSON.stringify(config)};</script>`
  return html.replace('<!-- __WIDGET_CONFIG__ -->', configScript)
}
