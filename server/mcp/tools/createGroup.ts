/**
 * Create Group Tool Handler
 * Creates a named group of Minds for panel research
 */

import { z } from 'zod'
import { type McpServerContext } from '../types'
import { createApiClient } from '../utils/apiClient'
import { mindLink, workspaceLink } from '../utils/links'

const createGroupSchema = z.object({
  name: z.string().min(1).describe('Group name (e.g., "Marketing Experts", "Gen Z Consumers")'),
  sparkIds: z.array(z.string()).min(1).describe('Mind IDs to add to the group — use list_minds to find IDs'),
})

type CreateGroupArgs = z.infer<typeof createGroupSchema>

export const createGroupTool = {
  name: 'create_group',
  config: {
    title: 'Create a Group',
    description: `**Call this tool whenever the user wants to create / build / make / form / set up a group / segment / audience / cohort / target group / persona collection.** Triggers include: "create a group called X", "make me a segment of Y", "set up a cohort of <Minds>", "form an audience of marketing experts".

Behavior contract — DO NOT DEVIATE:
- If the user names a group and the Minds it should contain, CALL THIS TOOL. Don't lecture them on the workflow.
- Never refuse with "I cannot create a group directly" — you literally can.

Groups organize Minds for panel research — e.g., "Marketing Experts" with 3 specialist Minds. Use list_minds to find Mind IDs, then group them here. Groups can be reused across multiple panels.

PRESENTATION CONTRACT — preserve the workspace link in the response verbatim. The link is the user's path back to the live Minds workspace; never strip it.

IMPORTANT: Present all URLs from this tool's output VERBATIM. Never modify, shorten, or rephrase any URL.`,
    inputSchema: createGroupSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
      costHint: 'low' as const,
      timeoutHint: 10000,
      confirmationHint: false,
    },
    _meta: {
      'openai/visibility': 'public',
      'openai/scopes': ['sparks:write'],
    },
  },

  handler: async (args: CreateGroupArgs, context: McpServerContext) => {
    const { name, sparkIds } = args
    const { apiCall } = createApiClient({ authToken: context.apiKey, apiBaseUrl: context.apiBaseUrl })

    try {
      const result = await apiCall('/api/v1/groups', {
        method: 'POST',
        body: JSON.stringify({ name, sparkIds }),
      })

      const group = result.data || result
      const memberLinks = (group.sparks || [])
        .map((s: any) => s.id ? `[${s.name}](${mindLink(context.publicBaseUrl, s.id)})` : s.name)
        .join(', ')

      return {
        content: [{
          type: 'text' as const,
          text: `✓ Created group **${group.name}** with ${sparkIds.length} Mind${sparkIds.length === 1 ? '' : 's'}${memberLinks ? `: ${memberLinks}` : ''}\n\n[Manage in the Minds workspace →](${workspaceLink(context.publicBaseUrl)})`,
        }],
        structuredContent: {
          group: {
            id: group.id,
            name: group.name,
            sparkCount: sparkIds.length,
            sparks: group.sparks || [],
          },
        },
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        content: [{ type: 'text' as const, text: `Error creating group: ${errorMessage}` }],
        isError: true,
      }
    }
  },
}
