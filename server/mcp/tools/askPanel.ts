/**
 * Ask Panel Tool - asks a survey question to all groups in a panel
 */
import type { McpServerContext } from '../types'
import { createApiClient } from '../utils/apiClient'
import { findBestMatch } from '../utils/fuzzyMatch'
import { logger, API_BASE_URL } from '../config'

interface AskPanelArgs { panelId?: string; panelName?: string; question: string; groupIds?: string[] }

export const askPanelTool = {
  name: 'ask_panel',
  config: {
    title: 'Ask Panel Question',
    description: `Ask a survey question to all groups in a panel. Questions are auto-classified as scale (1-5, 1-10), categorical (yes/no, multiple choice), or qualitative (open-ended). Each AI persona responds with structured output, and results are aggregated with cross-group comparisons. Qualitative responses are clustered into topics. Supports fuzzy panel name matching.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        panelId: { type: 'string', description: 'Panel ID (UUID)' },
        panelName: { type: 'string', description: 'Panel name (fuzzy matched)' },
        question: { type: 'string', description: 'Question to ask all groups' },
        groupIds: { type: 'array', items: { type: 'string' }, description: 'Only ask specific groups (defaults to all)' },
      },
      required: ['question'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, costHint: 'high' as const, timeoutHint: 120000, confirmationHint: false },
  },

  handler: async (args: AskPanelArgs, context: McpServerContext) => {
    const { apiCall } = createApiClient({ authToken: context.apiKey, apiBaseUrl: context.apiBaseUrl })
    try {
      let resolvedPanelId = args.panelId
      if (!resolvedPanelId && args.panelName) {
        const panels = await apiCall('/api/v1/panels')
        const list = panels.data || []
        if (!list.length) return { content: [{ type: 'text' as const, text: 'No panels found. Create one first.' }], isError: true }
        const match = findBestMatch(args.panelName, list, (p: any) => p.name, 50)
        if (!match) return { content: [{ type: 'text' as const, text: `No panel matching "${args.panelName}". Available: ${list.map((p: any) => p.name).join(', ')}` }], isError: true }
        resolvedPanelId = match.item.id
      }
      if (!resolvedPanelId) return { content: [{ type: 'text' as const, text: 'Provide panelId or panelName.' }], isError: true }

      // Call panel-stream SSE endpoint and collect results
      const baseUrl = context.apiBaseUrl || API_BASE_URL
      const sseResponse = await fetch(`${baseUrl}/api/panel-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(context.apiKey ? { Authorization: `Bearer ${context.apiKey}` } : {}) },
        body: JSON.stringify({ flowId: resolvedPanelId, question: args.question, groupIds: args.groupIds }),
      })
      if (!sseResponse.ok) throw new Error(`Panel stream failed: ${sseResponse.status}`)

      const text = await sseResponse.text()
      let outputData: any = null
      for (const line of text.split('\n')) {
        if (line.startsWith('data: ')) {
          try { const d = JSON.parse(line.slice(6)); if (d.type === 'result') outputData = d.outputData } catch {}
        }
      }
      if (!outputData) return { content: [{ type: 'text' as const, text: 'Survey completed but no results returned.' }], isError: true }

      const lines: string[] = [`📊 Panel Results: ${outputData.title}`, `Type: ${outputData.type}`, '']
      for (const g of outputData.groups || []) {
        lines.push(`**${g.group}** (dominant: ${g.value})`)
        for (const a of g.answers || []) lines.push(`  - ${a.persona}${a.discipline ? ` (${a.discipline})` : ''}: ${a.value}`)
        lines.push('')
      }
      return { content: [{ type: 'text' as const, text: lines.join('\n') }], structuredContent: { panelId: resolvedPanelId, question: args.question, outputData, outputType: 'bar' } }
    } catch (error) {
      return { content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true }
    }
  },
}
