/**
 * Creation Widget Resource — shows Mind training progress
 */
import { buildWidgetMeta } from './widgetMeta'
import { getWidgetHtml } from './widgetHtml'
import type { McpServerContext } from '../types'

export const creationWidgetResource = {
  name: 'creation-widget',
  uri: 'ui://widget/creation.html',
  metadata: {
    title: 'Mind Creation Progress',
    description: 'Shows real-time training progress when creating a new Mind.',
  },

  handler: async (context: McpServerContext) => {
    const html = getWidgetHtml('creation', {
      type: 'creation',
      apiBase: context.publicBaseUrl || 'https://getminds.ai',
      sparkId: context.latestSparkId,
    })

    return {
      contents: [{
        uri: 'ui://widget/creation.html',
        mimeType: 'text/html;profile=mcp-app',
        text: html,
        _meta: buildWidgetMeta(context.publicBaseUrl, 500),
      }],
    }
  },
}
