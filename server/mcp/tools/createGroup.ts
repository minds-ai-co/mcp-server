/**
 * Create Group Tool Handler
 * Creates a named group of Minds for panel research
 */

import { z } from 'zod'
import { type McpServerContext } from '../types'
import { createApiClient } from '../utils/apiClient'
import { workspaceLink } from '../utils/links'

const createGroupSchema = z.object({
  name: z.string().min(1).describe('Group name (e.g., "Marketing Experts", "Gen Z Consumers")'),
  sparkIds: z.array(z.string()).min(1).describe('Mind IDs to add to the group — use list_minds to find IDs'),
})

type CreateGroupArgs = z.infer<typeof createGroupSchema>

export const createGroupTool = {
  name: 'create_group',
  config: {
    title: 'Create a Group',
    description: `Create a named group of Minds. Groups organize Minds for panel research — e.g., "Marketing Experts" with 3 specialist Minds.

Use list_minds to find Mind IDs, then group them here. Groups can be reused across multiple panels.

IMPORTANT: Present all URLs from this tool's output VERBATIM. Never modify or rephrase any URL.`,
    inputSchema: createGroupSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
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
      const memberNames = (group.sparks || []).map((s: any) => s.name).join(', ')

      return {
        content: [{
          type: 'text' as const,
          text: `✓ Created group "${group.name}" with ${sparkIds.length} Mind(s)${memberNames ? `: ${memberNames}` : ''}\n\nGroup ID: ${group.id}\nManage in Minds AI: ${workspaceLink(context.publicBaseUrl)}`,
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
