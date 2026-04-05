/**
 * Load pre-built widget HTML and inject __WIDGET_CONFIG__.
 *
 * Searches multiple paths:
 * - widgets/dist/ (dev: local vite build output)
 * - public/_widgets/ (build step copies here before nuxt build)
 * - .output/public/_widgets/ (production: inside Nitro output)
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { logger } from '../config'

// Cache loaded HTML in memory (read once at startup)
const cache = new Map<string, string>()

function findWidgetFile(name: string): string | null {
  const cwd = process.cwd()
  const candidates = [
    resolve(cwd, `widgets/dist/${name}.html`),
    resolve(cwd, `public/_widgets/${name}.html`),
    resolve(cwd, `.output/public/_widgets/${name}.html`),
    // Nitro server runs from .output/server/, so go up one level
    resolve(cwd, `../public/_widgets/${name}.html`),
  ]
  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  return null
}

function loadWidget(name: 'creation' | 'info' | 'response'): string {
  if (cache.has(name)) return cache.get(name)!

  const path = findWidgetFile(name)
  if (!path) {
    logger.error(`Widget HTML not found: ${name}`, { cwd: process.cwd() })
    return `<!DOCTYPE html><html><body><p style="color:#ef4444;padding:2rem">Widget "${name}" not built. Run: pnpm build:widgets</p></body></html>`
  }

  try {
    const html = readFileSync(path, 'utf-8')
    logger.info(`Loaded widget HTML: ${name} from ${path}`)
    cache.set(name, html)
    return html
  } catch (err) {
    logger.error(`Failed to read widget HTML: ${name} at ${path}`, { error: err instanceof Error ? err.message : String(err) })
    return `<!DOCTYPE html><html><body><p style="color:#ef4444;padding:2rem">Widget "${name}" not built. Run: pnpm build:widgets</p></body></html>`
  }
}

export function getWidgetHtml(name: 'creation' | 'info' | 'response', config: Record<string, any>): string {
  const html = loadWidget(name)
  const configScript = `<script>window.__WIDGET_CONFIG__ = ${JSON.stringify(config)};</script>`
  return html.replace('<!-- __WIDGET_CONFIG__ -->', configScript)
}
