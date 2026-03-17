/**
 * Export Panel Tool - generates a structured report from panel survey results
 */
import type { McpServerContext } from '../types'
import { createApiClient } from '../utils/apiClient'
import { findBestMatch } from '../utils/fuzzyMatch'

interface ExportPanelArgs { panelId?: string; panelName?: string; format?: 'md' | 'xls' }

export const exportPanelTool = {
  name: 'export_panel',
  config: {
    title: 'Export Panel Report',
    description: `Export a comprehensive survey report from a panel's results. Generates structured market research report with cross-group comparisons, key insights, and recommendations. Supports MD format.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        panelId: { type: 'string', description: 'Panel ID (UUID)' },
        panelName: { type: 'string', description: 'Panel name (fuzzy matched)' },
        format: { type: 'string', enum: ['md', 'xls'], description: 'Export format (default: md)' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, costHint: 'medium' as const, timeoutHint: 30000, confirmationHint: false },
  },

  handler: async (args: ExportPanelArgs, context: McpServerContext) => {
    const { apiCall } = createApiClient({ authToken: context.apiKey, apiBaseUrl: context.apiBaseUrl })
    try {
      let resolvedPanelId = args.panelId
      if (!resolvedPanelId && args.panelName) {
        const panels = await apiCall('/api/v1/panels')
        const list = panels.data || []
        if (!list.length) return { content: [{ type: 'text' as const, text: 'No panels found.' }], isError: true }
        const match = findBestMatch(args.panelName, list, (p: any) => p.name, 50)
        if (!match) return { content: [{ type: 'text' as const, text: `No panel matching "${args.panelName}".` }], isError: true }
        resolvedPanelId = match.item.id
      }
      if (!resolvedPanelId) return { content: [{ type: 'text' as const, text: 'Provide panelId or panelName.' }], isError: true }

      const result = await apiCall(`/api/v1/panels/${resolvedPanelId}/export`, { method: 'POST', body: JSON.stringify({ format: args.format || 'md' }) })
      const report = result.data?.content || result.content || 'No report generated'
      return { content: [{ type: 'text' as const, text: report }], structuredContent: { panelId: resolvedPanelId, format: args.format || 'md', report } }
    } catch (error) {
      return { content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true }
    }
  },
}
