/**
 * Export Panel Tool - generates a structured report from panel survey results
 */
import type { McpServerContext } from '../types'
import { exportPanelSchema } from '../types'
import { createApiClient } from '../utils/apiClient'
import { findBestMatch } from '../utils/fuzzyMatch'
import { chatLink } from '../utils/links'

interface ExportPanelArgs { panelId?: string; panelName?: string; format?: 'md' | 'pdf' | 'json' }

export const exportPanelTool = {
  name: 'export_panel',
  config: {
    title: 'Export Panel Report',
    description: `Export a panel's survey results as a report. Compiles all questions and responses into a structured document with cross-group analysis.

Formats:
- "md" (default): Markdown report returned inline
- "pdf": Branded PDF with executive summary and recommendations — queued async, use get_panel_status to check when ready
- "json": Raw structured data for further analysis

Requires a panel with at least one answered question (use ask_panel first).`,
    inputSchema: exportPanelSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false, costHint: 'high' as const, timeoutHint: 120000, confirmationHint: false },
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

      const format = args.format || 'md'

      // JSON: return structured panel data directly
      if (format === 'json') {
        const panel = await apiCall(`/api/v1/panels/${resolvedPanelId}`)
        const data = panel.data || panel
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
          structuredContent: { panelId: resolvedPanelId, format: 'json', data },
        }
      }

      // PDF: async queue job, return job ID
      if (format === 'pdf') {
        const result = await apiCall(`/api/v1/panels/${resolvedPanelId}/export`, { method: 'POST', body: JSON.stringify({ format: 'pdf' }) })
        const jobId = result.data?.jobId || result.jobId
        if (jobId) {
          return {
            content: [{ type: 'text' as const, text: `PDF export started (job: ${jobId}). Use get_panel_status to check when the download is ready.\n\nOpen panel: ${chatLink(context.publicBaseUrl, resolvedPanelId)}` }],
            structuredContent: { panelId: resolvedPanelId, format: 'pdf', jobId, status: 'queued' },
          }
        }
        // If no jobId, the API may have returned the PDF content directly
        const content = result.data?.content || result.content
        if (content) {
          return {
            content: [{ type: 'text' as const, text: 'PDF export generated.' }],
            structuredContent: { panelId: resolvedPanelId, format: 'pdf', content },
          }
        }
        return { content: [{ type: 'text' as const, text: 'PDF export failed — no job ID or content returned.' }], isError: true }
      }

      // MD: synchronous markdown report (LLM-generated, can be slow)
      const result = await apiCall(`/api/v1/panels/${resolvedPanelId}/export`, { method: 'POST', body: JSON.stringify({ format: 'md' }), timeout: 180000 })
      const report = result.data?.content || result.content || 'No report generated'
      return { content: [{ type: 'text' as const, text: `${report}\n\n---\nOpen panel: ${chatLink(context.publicBaseUrl, resolvedPanelId)}` }], structuredContent: { panelId: resolvedPanelId, format: 'md', report } }
    } catch (error) {
      return { content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true }
    }
  },
}
