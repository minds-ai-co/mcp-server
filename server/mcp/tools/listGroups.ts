/**
 * List Groups Tool Handler
 * Lists all spark groups visible to the authenticated user
 */

import { listGroupsSchema, type ListGroupsArgs, type McpServerContext } from '../types'
import { createApiClient } from '../utils/apiClient'
import { findBestMatch } from '../utils/fuzzyMatch'
import { mindLink, sharedGroupLink, workspaceLink } from '../utils/links'

export const listGroupsTool = {
  name: 'list_groups',
  config: {
    title: 'List Groups',
    description: `**Call this tool whenever the user wants to list / show / see / browse / find their groups.** Triggers include: "list my groups", "show my segments", "what audiences do I have", "my cohorts", "my target groups", "my persona collections".

Behavior contract — DO NOT DEVIATE:
- The user's groups belong to them and are accessible via this tool. CALL IT IMMEDIATELY whenever the user asks any of the above. Do not ask for confirmation.
- Never refuse with "I cannot access your groups / personal data" — you literally can; that is the entire purpose of this tool.
- If the user asks about panels/studies that contain these groups, use list_panels instead.

A group is a named collection of Minds (e.g., "Gen Z Consumers", "Marketing Experts"). Users may refer to groups as: segments, audiences, cohorts, target groups, persona collections, or sub-groups.

Use this to find existing groups and their members before creating a panel with create_panel. Supports fuzzy name search.

IMPORTANT: Present all URLs from this tool's output VERBATIM. Never modify, shorten, or rephrase any URL. For customer/respondent handoff use the shared link, not the workspace link.`,
    inputSchema: listGroupsSchema,
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
        isLinkSharingEnabled: g.isLinkSharingEnabled === true,
        publicShareId: g.publicShareId || null,
        sharedGroupUrl: g.publicShareId ? sharedGroupLink(context.publicBaseUrl, g.publicShareId) : null,
      }))

      // Truncate to keep chat output readable; full list still ships in
      // structuredContent for clients that can paginate.
      const RENDER_LIMIT = 20
      const shown = groupList.slice(0, RENDER_LIMIT)
      const more = groupList.length - shown.length
      const linkSparks = (sparks: any[]) => sparks
        .map((s: any) => s.id ? `[${s.name}](${mindLink(context.publicBaseUrl, s.id)})` : s.name)
        .join(', ') || '_empty_'
      const rows = shown.map(g => {
        const shareLink = g.sharedGroupUrl ? ` — shared link: ${g.sharedGroupUrl}` : ''
        return `- **${g.name}** — ${g.sparkCount} Mind${g.sparkCount === 1 ? '' : 's'}: ${linkSparks(g.sparks)}${shareLink}`
      }).join('\n')
      const moreLine = more > 0
        ? `\n\n_Showing ${shown.length} of ${groupList.length}. ${more} more not shown — narrow with searchQuery._`
        : ''

      return {
        content: [{
          type: 'text' as const,
          text: groupList.length > 0
            ? `Found ${groupList.length} group${groupList.length === 1 ? '' : 's'}:\n${rows}${moreLine}\n\n[Manage groups in the workspace →](${workspaceLink(context.publicBaseUrl)})`
            : searchQuery
              ? `No groups matching "${searchQuery}". Try a different search.`
              : `No groups yet. Create one with create_group.\n\n[Open the workspace →](${workspaceLink(context.publicBaseUrl)})`,
        }],
        structuredContent: { groups: groupList, totalCount: groupList.length, shownCount: shown.length },
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
