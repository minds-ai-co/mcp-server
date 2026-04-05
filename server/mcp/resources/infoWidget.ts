/**
 * Info Widget Resource — shows Mind or Group details
 */
import { buildWidgetMeta } from './widgetMeta'
import { getWidgetHtml } from './widgetHtml'
import type { McpServerContext } from '../types'

export const infoWidgetResource = {
  name: 'info-widget',
  uri: 'ui://widget/info.html',
  metadata: {
    title: 'Mind / Group Info',
    description: 'Shows details about a Mind or Group including members and metadata.',
  },

  handler: async (context: McpServerContext & { infoEntity?: 'spark' | 'group'; infoEntityId?: string; infoData?: any }) => {
    const html = getWidgetHtml('info', {
      type: 'info',
      apiBase: context.publicBaseUrl || 'https://getminds.ai',
      authToken: context.apiKey,
      entity: context.infoEntity || 'spark',
      entityId: context.infoEntityId,
      sparkData: context.infoEntity === 'spark' ? context.infoData : undefined,
      groupData: context.infoEntity === 'group' ? context.infoData : undefined,
    })

    return {
      contents: [{
        uri: 'ui://widget/info.html',
        mimeType: 'text/html;profile=mcp-app',
        text: html,
        _meta: buildWidgetMeta(context.publicBaseUrl, 400),
      }],
    }
  },
}
