/**
 * List Panels Tool Handler
 * Lists all research panels for the authenticated user
 */

import { listPanelsSchema, type ListPanelsArgs, type McpServerContext } from '../types'
import { createApiClient } from '../utils/apiClient'
import { findBestMatch } from '../utils/fuzzyMatch'
import { chatLink } from '../utils/links'

export const listPanelsTool = {
  name: 'list_panels',
  config: {
    title: 'List Panels',
    description: `List all panels the user has created, with their groups and question counts.

Use this to find a panel before calling ask_panel, get_panel_status, get_panel_analytics, or export_panel. Supports fuzzy name search.

IMPORTANT: Present all URLs from this tool's output VERBATIM. Never modify, shorten, or rephrase any URL. Copy each link exactly as returned.`,
    inputSchema: listPanelsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
      costHint: 'low' as const,
      timeoutHint: 10000,
      confirmationHint: false,
    },
    _meta: {
      'openai/visibility': 'public',
      'openai/scopes': ['flows:read'],
    },
  },

  handler: async (args: ListPanelsArgs, context: McpServerContext) => {
    const { searchQuery } = args
    const { apiCall } = createApiClient({ authToken: context.apiKey, apiBaseUrl: context.apiBaseUrl })

    try {
      const result = await apiCall('/api/v1/panels')
      let panels: any[] = result.data || []

      // Client-side fuzzy filter if search query provided
      if (searchQuery && panels.length > 0) {
        const match = findBestMatch(searchQuery, panels, (p: any) => p.name, 40)
        panels = match ? [match.item] : []
      }

      const panelList = panels.map((p: any) => ({
        id: p.id,
        name: p.name,
        messageCount: p.messageCount || 0,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        groups: (p.groups || []).map((g: any) => ({
          id: g.id,
          name: g.name,
          sparkCount: g.sparkCount || g.sparks?.length || 0,
          sparks: (g.sparks || []).map((s: any) => ({ id: s.id, name: s.name, discipline: s.discipline })),
        })),
      }))

      return {
        content: [{
          type: 'text' as const,
          text: panelList.length > 0
            ? `Found ${panelList.length} panel(s):\n\n| Panel | Groups | Questions | Link |\n|-------|--------|-----------|------|\n${panelList.map(p => `| ${p.name} | ${p.groups.length} | ${p.messageCount} | [Open](${chatLink(context.publicBaseUrl, p.id)}) |`).join('\n')}`
            : searchQuery
              ? `No panels matching "${searchQuery}". Use list_panels without a search query to see all panels.`
              : 'No panels found. Create one using the create_panel tool.',
        }],
        structuredContent: { panels: panelList },
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        content: [{ type: 'text' as const, text: `Error listing panels: ${errorMessage}` }],
        isError: true,
      }
    }
  },
}
