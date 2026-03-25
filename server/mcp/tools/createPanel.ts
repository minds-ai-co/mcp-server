/**
 * Create Panel Tool - creates a panel survey with groups of AI sparks
 */
import type { McpServerContext } from '../types'
import { createPanelSchema } from '../types'
import { createApiClient } from '../utils/apiClient'

interface CreatePanelArgs {
  name: string
  groupConfigs?: Array<{ name: string; sparkIds: string[] }>
  groupIds?: string[]
}

export const createPanelTool = {
  name: 'create_panel',
  config: {
    title: 'Create Survey Panel',
    description: `Create a structured survey panel with groups of AI personas for market research, focus groups, or structured interviews. You can reference existing groups by ID or create new ones inline.`,
    inputSchema: createPanelSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, costHint: 'low' as const, timeoutHint: 15000, confirmationHint: false },
  },

  handler: async (args: CreatePanelArgs, context: McpServerContext) => {
    const { apiCall } = createApiClient({ authToken: context.apiKey, apiBaseUrl: context.apiBaseUrl })
    try {
      const allGroupIds: string[] = [...(args.groupIds || [])]
      if (args.groupConfigs?.length) {
        for (const gc of args.groupConfigs) {
          const groupResult = await apiCall('/api/spark/groups', { method: 'POST', body: JSON.stringify({ name: gc.name }) })
          const groupId = groupResult.data?.id
          if (!groupId) continue
          for (const sparkId of gc.sparkIds) await apiCall(`/api/spark/groups/${groupId}/members`, { method: 'POST', body: JSON.stringify({ sparkId }) })
          allGroupIds.push(groupId)
        }
      }
      const result = await apiCall('/api/panel/create', { method: 'POST', body: JSON.stringify({ name: args.name, groupIds: allGroupIds }) })
      const groupSummary = result.groups?.map((g: any) => `${g.name} (${g.sparks?.length || 0} sparks)`).join(', ') || 'no groups'
      return { content: [{ type: 'text' as const, text: `✓ Created panel "${result.name}" with ${result.groups?.length || 0} groups: ${groupSummary}` }], structuredContent: { panelId: result.id, name: result.name, groups: result.groups } }
    } catch (error) {
      return { content: [{ type: 'text' as const, text: `Error creating panel: ${error instanceof Error ? error.message : String(error)}` }], isError: true }
    }
  },
}
