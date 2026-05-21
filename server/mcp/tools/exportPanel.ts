/**
 * Export Panel Tool - generates a structured report from panel survey results
 */
import type { McpServerContext } from '../types'
import { exportPanelSchema } from '../types'
import { createApiClient } from '../utils/apiClient'
import { findBestMatch } from '../utils/fuzzyMatch'
import { chatLink } from '../utils/links'

interface ExportPanelArgs { panelId?: string; panelName?: string; format?: 'pdf' | 'json' | 'csv' | 'xls' | 'md' | 'markdown' }

export const exportPanelTool = {
  name: 'export_panel',
  config: {
    title: 'Export Panel Report',
    description: `**Call this tool whenever the user wants to export, download, save, send, share, or get a report / PDF / spreadsheet / CSV / Excel / JSON of a panel's results.** Triggers include: "export the panel", "download the report", "give me a PDF of <panel>", "send me the results as CSV", "share the study findings", "I need the data".

Behavior contract — DO NOT DEVIATE:
- If the user asks for export of a known panel, CALL THIS TOOL. Don't tell them to do it manually.
- Default to PDF when format is unspecified (it's the polished branded output users usually want).
- Never refuse with "I cannot export the panel directly" — you literally can.

Compiles all questions and responses into a structured document.

Formats:
- "pdf" (default): Branded PDF with executive summary and recommendations — queued async, use get_panel_status to check when ready
- "csv": Spreadsheet with all questions, groups, personas, answers, and full responses
- "xls": Excel-compatible spreadsheet (same data as CSV)
- "json": Raw structured data for further analysis
- "md": Markdown report (heading-per-question + bulleted answers per group)

If the user references a panel by name (including a panel created in a previous chat / session), pass it as panelName — fuzzy match resolves it server-side against ALL of the user's panels, not just the current chat. Do not refuse with "I don't have access to that panel" or ask the user to paste/upload data; let the tool resolve it. The panel must have at least one answered question — if export fails because there are no answers yet, surface that and suggest ask_panel.

PRESENTATION CONTRACT — preserve the panel link and (when present) the download link verbatim. The panel link is the user's path back to the live Minds workspace; the download link is their access to the file. Never strip either.

IMPORTANT: Present all URLs from this tool's output VERBATIM. Never modify, shorten, or rephrase any URL.`,
    inputSchema: exportPanelSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true, costHint: 'high' as const, timeoutHint: 120000, confirmationHint: false },
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

      const rawFormat = args.format || 'pdf'
      const format = rawFormat === 'markdown' ? 'md' : rawFormat

      // Fetch panel data (needed for CSV, XLS, JSON, MD)
      if (format === 'json' || format === 'csv' || format === 'xls' || format === 'md') {
        const panel = await apiCall(`/api/v1/panels/${resolvedPanelId}`)
        const data = panel.data || panel

        if (format === 'json') {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
            structuredContent: { panelId: resolvedPanelId, format: 'json', data },
          }
        }

        if (format === 'md') {
          const lines: string[] = []
          lines.push(`# Panel: ${data.name || 'Untitled'}`)
          const messages = (data.messages || []).filter((m: any) => m.role === 'assistant')

          let qIndex = 0
          for (const msg of messages) {
            const metadata = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : msg.metadata
            if (!metadata?.outputData) continue
            const od = metadata.outputData
            const question = od.title || od.formattedQuestion || ''
            qIndex += 1
            lines.push('')
            lines.push(`## Q${qIndex}. ${question}`)
            for (const group of od.groups || []) {
              lines.push(`### Group: ${group.group}`)
              for (const answer of group.answers || []) {
                const body = answer.message || (answer.value != null ? String(answer.value) : '')
                const discipline = answer.discipline ? ` (${answer.discipline})` : ''
                lines.push(`- **${answer.persona}**${discipline}: ${body}`)
              }
            }
          }

          // Size cap: MCP responses get forwarded into LLM context windows. Anything
          // over ~100KB blows past most clients' practical limit and can blow up
          // streaming. Truncate with a clear marker so the caller knows.
          const MAX_MD_CHARS = 100_000
          let content = lines.join('\n')
          if (content.length > MAX_MD_CHARS) {
            const fullLength = content.length
            content = content.slice(0, MAX_MD_CHARS)
              + `\n\n…(truncated — full export ${fullLength.toLocaleString()} chars; `
              + `use format='json' or format='csv' for the complete dataset)`
          }

          return {
            content: [{ type: 'text' as const, text: content }],
            structuredContent: { panelId: resolvedPanelId, format: 'md', content, filename: 'panel_export.md' },
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
          content: [{ type: 'text' as const, text: `✓ ${format.toUpperCase()} export ready — ${rows.length - 1} data rows.\n\n[Open this panel in Minds →](${chatLink(context.publicBaseUrl, resolvedPanelId)})` }],
          structuredContent: { panelId: resolvedPanelId, format, content, filename: `panel_export.${ext}`, rows: rows.length - 1 },
        }
      }

      // PDF: async queue job, return job ID
      const result = await apiCall(`/api/v1/panels/${resolvedPanelId}/export`, { method: 'POST', body: JSON.stringify({ format: 'pdf' }) })
      const jobId = result.data?.jobId || result.jobId
      if (jobId) {
        return {
          content: [{ type: 'text' as const, text: `✓ PDF export started (job ${jobId}). Use get_panel_status to check when the download is ready.\n\n[Open this panel in Minds →](${chatLink(context.publicBaseUrl, resolvedPanelId)})` }],
          structuredContent: { panelId: resolvedPanelId, format: 'pdf', jobId, status: 'queued' },
        }
      }
      return { content: [{ type: 'text' as const, text: 'PDF export failed — no job ID returned.' }], isError: true }
    } catch (error) {
      return { content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true }
    }
  },
}
