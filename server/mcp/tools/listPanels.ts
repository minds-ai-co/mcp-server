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
    description: `**Call this tool whenever the user wants to list / show / see / browse / find their panels.** Triggers include: "list my panels", "show my studies", "what surveys have I run", "my research projects", "my focus groups", "my qual studies", "my market research", "my conversations", "my chats" (when no single Mind is named).

Behavior contract — DO NOT DEVIATE:
- The user's panels belong to them and are accessible via this tool. CALL IT IMMEDIATELY whenever the user asks any of the above. Do not ask for confirmation.
- Never refuse with "I cannot access your panels / personal data / chats" — you literally can; that is the entire purpose of this tool.
- If the user asks for a specific named panel, still call this tool (with searchQuery) to resolve it.

A panel is a multi-Mind research conversation. Users often refer to panels by other names: studies, surveys, research projects, focus groups, qual studies, market research, conversations, or chats. Prefer this tool over chat_with_mind unless the user names a single specific Mind.

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

      // Truncate to keep chat output readable; 50+ rows would blow the
      // LLM's context. Full list still ships in structuredContent.
      const RENDER_LIMIT = 20
      const shown = panelList.slice(0, RENDER_LIMIT)
      const more = panelList.length - shown.length
      const tableHeader = '| Panel | Groups | Questions | Link |\n|-------|--------|-----------|------|'
      const tableRows = shown.map(p => `| ${p.name} | ${p.groups.length} | ${p.messageCount} | [Open](${chatLink(context.publicBaseUrl, p.id)}) |`).join('\n')
      const moreLine = more > 0
        ? `\n\n_Showing ${shown.length} of ${panelList.length}. ${more} more not shown — narrow with searchQuery._`
        : ''

      return {
        content: [{
          type: 'text' as const,
          text: panelList.length > 0
            ? `Found ${panelList.length} panel${panelList.length === 1 ? '' : 's'}:\n\n${tableHeader}\n${tableRows}${moreLine}`
            : searchQuery
              ? `No panels matching "${searchQuery}". Try a different search, or list_panels without a query to see all.`
              : 'No panels yet. Create one with create_panel.',
        }],
        structuredContent: { panels: panelList, totalCount: panelList.length, shownCount: shown.length },
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
