/**
 * Load pre-built widget HTML and inject __WIDGET_CONFIG__.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { logger } from '../config'

const WIDGET_DIR = resolve(process.cwd(), 'widgets/dist')

// Cache loaded HTML in memory (read once at startup)
const cache = new Map<string, string>()

function loadWidget(name: 'creation' | 'info' | 'response'): string {
  if (cache.has(name)) return cache.get(name)!

  try {
    const html = readFileSync(resolve(WIDGET_DIR, `${name}.html`), 'utf-8')
    cache.set(name, html)
    return html
  } catch (err) {
    logger.error(`Failed to load widget HTML: ${name}`, { error: err instanceof Error ? err.message : String(err) })
    return `<!DOCTYPE html><html><body><p style="color:#ef4444;padding:2rem">Widget "${name}" not built. Run: pnpm build:widgets</p></body></html>`
  }
}

export function getWidgetHtml(name: 'creation' | 'info' | 'response', config: Record<string, any>): string {
  const html = loadWidget(name)
  const configScript = `<script>window.__WIDGET_CONFIG__ = ${JSON.stringify(config)};</script>`
  return html.replace('<!-- __WIDGET_CONFIG__ -->', configScript)
}
