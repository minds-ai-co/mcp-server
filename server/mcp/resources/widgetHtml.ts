/**
 * Load pre-built widget HTML and inject __WIDGET_CONFIG__.
 *
 * Searches multiple paths:
 * - widgets/dist/ (dev: local vite build output)
 * - public/_widgets/ (build step copies here before nuxt build)
 * - .output/public/_widgets/ (production: inside Nitro output)
 */

import { readFileSync, existsSync, readdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { logger } from '../config'

// Cache loaded HTML in memory (read once at startup)
const cache = new Map<string, string>()

// Resolve the directory of THIS file at import time (works in both dev and Nitro build)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function findWidgetFile(name: string): string | null {
  const cwd = process.cwd()
  const candidates = [
    // Dev: local vite build output
    resolve(cwd, `widgets/dist/${name}.html`),
    // Build step copies here before nuxt build
    resolve(cwd, `public/_widgets/${name}.html`),
    // Production: inside Nitro output (relative to CWD)
    resolve(cwd, `.output/public/_widgets/${name}.html`),
    // Nitro server CWD is .output/server/ — go up one level
    resolve(cwd, `../public/_widgets/${name}.html`),
    // Resolve relative to THIS file's location in the Nitro bundle
    // In prod: .output/server/chunks/ → ../../public/_widgets/
    resolve(__dirname, `../../public/_widgets/${name}.html`),
    resolve(__dirname, `../../../public/_widgets/${name}.html`),
    resolve(__dirname, `../../../../public/_widgets/${name}.html`),
  ]
  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  // Log all attempted paths for debugging
  logger.error(`Widget file not found: ${name}`, {
    cwd,
    serverDir: __dirname,
    tried: candidates,
  })
  return null
}

function loadWidget(name: 'creation' | 'info' | 'response'): string {
  if (cache.has(name)) return cache.get(name)!

  const path = findWidgetFile(name)
  if (!path) {
    logger.error(`Widget HTML not found: ${name}`)
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
