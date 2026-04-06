/**
 * Load pre-built widget HTML and inject __WIDGET_CONFIG__.
 *
 * Uses Nitro server assets (bundled at build time) so the HTML is
 * available regardless of CWD or filesystem layout in production.
 * Falls back to reading from widgets/dist/ for local dev.
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { useStorage } from '#imports'
import { logger } from '../config'

// Cache loaded HTML in memory (read once per widget)
const cache = new Map<string, string>()

const ERROR_HTML = (name: string) =>
  `<!DOCTYPE html><html><body><p style="color:#ef4444;padding:2rem">Widget "${name}" not built. Run: pnpm build:widgets</p></body></html>`

async function loadWidgetAsync(name: 'creation' | 'info' | 'response'): Promise<string> {
  if (cache.has(name)) return cache.get(name)!

  // 1. Try Nitro server assets (production — bundled at build time)
  try {
    const storage = useStorage('assets:server')
    const html = await storage.getItem(`widgets/${name}.html`)
    if (html && typeof html === 'string' && html.length > 200) {
      logger.info(`Loaded widget HTML from server assets: ${name}`)
      cache.set(name, html)
      return html
    }
  } catch (err) {
    // useStorage may not be available in dev or test contexts
    logger.debug(`Server assets not available for ${name}: ${err instanceof Error ? err.message : String(err)}`)
  }

  // 2. Fallback: read from filesystem (local dev)
  const devPath = resolve(process.cwd(), `widgets/dist/${name}.html`)
  if (existsSync(devPath)) {
    try {
      const html = readFileSync(devPath, 'utf-8')
      logger.info(`Loaded widget HTML from dev path: ${name}`)
      cache.set(name, html)
      return html
    } catch (err) {
      logger.error(`Failed to read widget HTML: ${name}`, { error: err instanceof Error ? err.message : String(err) })
    }
  }

  logger.error(`Widget HTML not found: ${name}`, { cwd: process.cwd() })
  return ERROR_HTML(name)
}

// Synchronous wrapper with async preload for cached reads
function loadWidget(name: 'creation' | 'info' | 'response'): string {
  if (cache.has(name)) return cache.get(name)!
  // Return error HTML synchronously, but trigger async load for next call
  loadWidgetAsync(name).catch(() => {})
  return ERROR_HTML(name)
}

/**
 * Preload all widgets into cache. Call once at startup.
 */
export async function preloadWidgets(): Promise<void> {
  const widgets = ['creation', 'info', 'response'] as const
  await Promise.allSettled(widgets.map(w => loadWidgetAsync(w)))
  logger.info(`Widget preload complete: ${widgets.map(w => `${w}=${cache.has(w) ? 'ok' : 'missing'}`).join(', ')}`)
}

export function getWidgetHtml(name: 'creation' | 'info' | 'response', config: Record<string, any>): string {
  const html = loadWidget(name)
  const configScript = `<script>window.__WIDGET_CONFIG__ = ${JSON.stringify(config)};</script>`
  return html.replace('<!-- __WIDGET_CONFIG__ -->', configScript)
}

/**
 * Async version for resource handlers that can await
 */
export async function getWidgetHtmlAsync(name: 'creation' | 'info' | 'response', config: Record<string, any>): Promise<string> {
  const html = await loadWidgetAsync(name)
  const configScript = `<script>window.__WIDGET_CONFIG__ = ${JSON.stringify(config)};</script>`
  return html.replace('<!-- __WIDGET_CONFIG__ -->', configScript)
}
