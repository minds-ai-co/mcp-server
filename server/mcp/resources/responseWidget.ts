/**
 * Response Widget Resource — shows panel survey results
 */
import { buildWidgetMeta } from './widgetMeta'
import { getWidgetHtmlAsync } from './widgetHtml'
import type { McpServerContext } from '../types'

export const responseWidgetResource = {
  name: 'response-widget',
  uri: 'ui://widget/response.html',
  metadata: {
    title: 'Panel Response',
    description: 'Shows panel survey results with bar diagrams, group comparisons, and persona cycling.',
  },

  handler: async (context: McpServerContext & { panelId?: string; questionId?: string; outputData?: any }) => {
    // Use explicit panelId/outputData if provided, otherwise fall back to latest from session
    const panelId = context.panelId || context.latestPanelId
    const outputData = context.outputData || context.latestOutputData

    const html = await getWidgetHtmlAsync('response', {
      type: 'response',
      apiBase: context.publicBaseUrl || 'https://getminds.ai',
      authToken: context.apiKey,
      panelId,
      questionId: context.questionId,
      outputData,
    })

    return {
      contents: [{
        uri: 'ui://widget/response.html',
        mimeType: 'text/html;profile=mcp-app',
        text: html,
        _meta: buildWidgetMeta(context.publicBaseUrl, 500),
      }],
    }
  },
}
