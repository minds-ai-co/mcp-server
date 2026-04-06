/**
 * Load pre-built widget HTML and inject __WIDGET_CONFIG__.
 *
 * Reads from Nitro server assets (bundled at build time via serverAssets config).
 * Falls back to filesystem for local dev.
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

  // 1. Read from Nitro server assets (bundled at build time)
  try {
    const storage = useStorage('assets:server')
    const html = await storage.getItem(`widgets/${name}.html`)
    if (html && typeof html === 'string' && !html.includes('__NUXT_DATA__')) {
      logger.info(`Loaded widget HTML from server assets: ${name} (${html.length} bytes)`)
      cache.set(name, html)
      return html
    }
  } catch (err) {
    logger.debug(`Server assets not available for ${name}: ${err instanceof Error ? err.message : String(err)}`)
  }

  // 2. Fallback: read from filesystem (local dev)
  const cwd = process.cwd()
  const candidates = [
    resolve(cwd, `widgets/dist/${name}.html`),
    resolve(cwd, `public/_widgets/${name}.html`),
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
