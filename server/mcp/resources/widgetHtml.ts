/**
 * Load pre-built widget HTML and inject __WIDGET_CONFIG__.
 *
 * Searches filesystem paths for widget HTML:
 * - widgets/dist/ (dev: vite build output)
 * - public/_widgets/ (dev: after build:widgets copies)
 * - .output/public/_widgets/ (production: Docker container)
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { logger } from '../config'

const cache = new Map<string, string>()

const ERROR_HTML = (name: string) =>
  `<!DOCTYPE html><html><body><p style="color:#ef4444;padding:2rem">Widget "${name}" not built. Run: pnpm build:widgets</p></body></html>`

function loadWidget(name: 'creation' | 'info' | 'response'): string {
  if (cache.has(name)) return cache.get(name)!

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
        logger.error(`Failed to read: ${name} at ${filePath}`, { error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  logger.error(`Widget HTML not found: ${name}`, { cwd, tried: candidates })
  return ERROR_HTML(name)
}

export function getWidgetHtml(name: 'creation' | 'info' | 'response', config: Record<string, any>): string {
  const html = loadWidget(name)
  const apiBase = (config.apiBase || 'https://getminds.ai').replace(/\/$/, '')
  // The widget runs in ChatGPT's sandbox iframe origin, so Vue/Three must load as
  // absolute URLs from THIS deploy's origin (which serves /embed/vendor with CORS).
  // The build emits a __MINDS_WIDGET_ORIGIN__ placeholder; substitute the serving origin.
  const withVendor = html.replaceAll('__MINDS_WIDGET_ORIGIN__', apiBase)
  const fontStyle = `<style>@font-face { font-family: 'Selecta'; src: url('${apiBase}/fonts/selecta-regular.woff2') format('woff2'); font-weight: 400; font-style: normal; font-display: swap; }</style>`
  const configScript = `${fontStyle}<script>window.__WIDGET_CONFIG__ = ${JSON.stringify(config)};</script>`
  return withVendor.replace('<!-- __WIDGET_CONFIG__ -->', configScript)
}

export async function getWidgetHtmlAsync(name: 'creation' | 'info' | 'response', config: Record<string, any>): Promise<string> {
  return getWidgetHtml(name, config)
}
