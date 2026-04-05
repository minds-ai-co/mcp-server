/**
 * List Groups Tool Handler
 * Lists all spark groups visible to the authenticated user
 */

import { listGroupsSchema, type ListGroupsArgs, type McpServerContext } from '../types'
import { createApiClient } from '../utils/apiClient'
import { findBestMatch } from '../utils/fuzzyMatch'
import { workspaceLink } from '../utils/links'

export const listGroupsTool = {
  name: 'list_groups',
  config: {
    title: 'List Groups',
    description: `List all groups visible to the user. A group is a named collection of Minds (e.g., "Gen Z Consumers", "Marketing Experts").

Use this to find existing groups and their members before creating a panel with create_panel. Supports fuzzy name search.`,
    inputSchema: listGroupsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      costHint: 'low' as const,
      timeoutHint: 10000,
      confirmationHint: false,
    },
    _meta: {
      'openai/visibility': 'public',
      'openai/scopes': ['sparks:read'],
    },
  },

  handler: async (args: ListGroupsArgs, context: McpServerContext) => {
    const { searchQuery } = args
    const { apiCall } = createApiClient({ authToken: context.apiKey, apiBaseUrl: context.apiBaseUrl })

    try {
      const result = await apiCall('/api/v1/groups')
      let groups: any[] = result.data || []

      // Client-side fuzzy filter if search query provided
      if (searchQuery && groups.length > 0) {
        const match = findBestMatch(searchQuery, groups, (g: any) => g.name, 40)
        groups = match ? [match.item] : []
      }

      const groupList = groups.map((g: any) => ({
        id: g.id,
        name: g.name,
        sparkCount: g.sparkCount || 0,
        sparks: (g.sparks || []).map((s: any) => ({ id: s.id, name: s.name, discipline: s.discipline })),
        currentMemberRole: g.currentMemberRole,
        isPublic: g.isPublic,
      }))

      return {
        content: [{
          type: 'text' as const,
          text: groupList.length > 0
            ? `Found ${groupList.length} group(s):\n${groupList.map(g => `- **${g.name}** — ${g.sparkCount} Mind(s): ${g.sparks.map((s: any) => s.name).join(', ') || 'empty'}\n  ID: ${g.id}`).join('\n')}\n\nManage groups: ${workspaceLink(context.publicBaseUrl)}`
            : searchQuery
              ? `No groups matching "${searchQuery}".`
              : `No groups found. Create one with create_group.\n\nOpen Minds AI: ${workspaceLink(context.publicBaseUrl)}`,
        }],
        structuredContent: { groups: groupList },
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        content: [{ type: 'text' as const, text: `Error listing groups: ${errorMessage}` }],
        isError: true,
      }
    }
  },
}
