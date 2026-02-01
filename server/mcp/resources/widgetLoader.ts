/**
 * Widget Loader
 * Loads widget HTML from API endpoints with caching
 */

import { API_BASE_URL, POLLING_CONFIG, logger } from '../config'

/**
 * Load the Spark Widget HTML from API endpoint
 * This unified widget supports both creation and chat modes
 */
export async function loadSparkWidget(publicUrl: string): Promise<string> {
  try {
    // Use localhost for fetching widget to avoid ngrok issues
    const baseUrl = publicUrl.includes('localhost') ? publicUrl : API_BASE_URL

    try {
      const url = `${baseUrl}/api/widgets/spark?_t=${Date.now()}`
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), POLLING_CONFIG.WIDGET_LOAD_TIMEOUT_MS)

      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'text/html' },
      })

      clearTimeout(timeoutId)

      if (response.ok) {
        const html = await response.text()
        if (html && html.length > 100) {
          logger.debug('Successfully loaded spark widget from API endpoint')
          return html
        }
      }
    } catch (fetchError: unknown) {
      if (fetchError instanceof Error && fetchError.name !== 'AbortError') {
        logger.warn('Failed to fetch spark widget from API', { error: fetchError.message })
      }
    }

    // Fallback
    logger.warn('Spark widget not found, using minimal fallback')
    return getFallbackSparkWidget()
  } catch (error) {
    logger.error('Critical error loading spark widget', error)
    return getFallbackSparkWidget()
  }
}

function getFallbackSparkWidget(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Minds AI - Spark</title><style>body{font-family:system-ui;padding:20px;background:#0a0a0b;color:#fff;}</style></head><body><p>Minds AI Spark Widget</p><p>Widget not loaded. Check server logs.</p></body></html>`
}
