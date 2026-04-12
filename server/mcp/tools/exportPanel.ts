/**
 * Export Panel Tool - generates a structured report from panel survey results
 */
import type { McpServerContext } from '../types'
import { exportPanelSchema } from '../types'
import { createApiClient } from '../utils/apiClient'
import { findBestMatch } from '../utils/fuzzyMatch'
import { chatLink } from '../utils/links'

interface ExportPanelArgs { panelId?: string; panelName?: string; format?: 'pdf' | 'json' | 'csv' | 'xls' }

export const exportPanelTool = {
  name: 'export_panel',
  config: {
    title: 'Export Panel Report',
    description: `Export a panel's survey results. Compiles all questions and responses into a structured document.

Formats:
- "pdf" (default): Branded PDF with executive summary and recommendations — queued async, use get_panel_status to check when ready
- "csv": Spreadsheet with all questions, groups, personas, answers, and full responses
- "xls": Excel-compatible spreadsheet (same data as CSV)
- "json": Raw structured data for further analysis

Requires a panel with at least one answered question (use ask_panel first).

IMPORTANT: Present all URLs from this tool's output VERBATIM. Never modify or rephrase any URL.`,
    inputSchema: exportPanelSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true, costHint: 'high' as const, timeoutHint: 120000, confirmationHint: false },
    _meta: {
      'openai/toolInvocation/invoking': 'Exporting panel report...',
      'openai/toolInvocation/invoked': 'Report ready!',
    },
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

      const format = args.format || 'pdf'

      // Fetch panel data (needed for CSV, XLS, JSON)
      if (format === 'json' || format === 'csv' || format === 'xls') {
        const panel = await apiCall(`/api/v1/panels/${resolvedPanelId}`)
        const data = panel.data || panel

        if (format === 'json') {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
            structuredContent: { panelId: resolvedPanelId, format: 'json', data },
          }
        }

        // Build tabular data from panel messages
        const separator = format === 'xls' ? '\t' : ','
        const rows: string[][] = [['Question', 'Group', 'Persona', 'Discipline', 'Answer', 'Full Response']]

        for (const msg of data.messages || []) {
          if (msg.role !== 'assistant') continue
          const metadata = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : msg.metadata
          if (!metadata?.outputData) continue
          const od = metadata.outputData
          const question = od.title || od.formattedQuestion || ''

          for (const group of od.groups || []) {
            for (const answer of group.answers || []) {
              const escape = (s: string) => format === 'csv' ? `"${(s || '').replace(/"/g, '""')}"` : (s || '').replace(/\t/g, ' ')
              rows.push([
                escape(question),
                escape(group.group),
                escape(answer.persona),
                escape(answer.discipline || ''),
                escape(answer.value),
                escape(answer.message || ''),
              ])
            }
          }
        }

        const content = rows.map(r => r.join(separator)).join('\n')
        const ext = format === 'xls' ? 'xls' : 'csv'
        return {
          content: [{ type: 'text' as const, text: `${format.toUpperCase()} export with ${rows.length - 1} data rows.\n\nOpen panel: ${chatLink(context.publicBaseUrl, resolvedPanelId)}` }],
          structuredContent: { panelId: resolvedPanelId, format, content, filename: `panel_export.${ext}`, rows: rows.length - 1 },
        }
      }

      // PDF: async queue job, return job ID
      const result = await apiCall(`/api/v1/panels/${resolvedPanelId}/export`, { method: 'POST', body: JSON.stringify({ format: 'pdf' }) })
      const jobId = result.data?.jobId || result.jobId
      if (jobId) {
        return {
          content: [{ type: 'text' as const, text: `PDF export started (job: ${jobId}). Use get_panel_status to check when the download is ready.\n\nLink: ${chatLink(context.publicBaseUrl, resolvedPanelId)}` }],
          structuredContent: { panelId: resolvedPanelId, format: 'pdf', jobId, status: 'queued' },
        }
      }
      return { content: [{ type: 'text' as const, text: 'PDF export failed — no job ID returned.' }], isError: true }
    } catch (error) {
      return { content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true }
    }
  },
}
