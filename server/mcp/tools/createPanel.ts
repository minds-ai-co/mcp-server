/**
 * Create Panel Tool - creates a panel survey with groups of AI sparks
 */
import type { McpServerContext } from '../types'
import { createPanelSchema } from '../types'
import { createApiClient } from '../utils/apiClient'
import { logger } from '../config'
import { chatLink } from '../utils/links'

interface CreatePanelArgs {
  name: string
  groupConfigs?: Array<{ name: string; sparkIds: string[] }>
  groupIds?: string[]
}

export const createPanelTool = {
  name: 'create_panel',
  config: {
    title: 'Create a Panel',
    description: `Create a market research panel. A panel contains one or more groups of Minds that are surveyed together for comparative analysis.

Workflow: first create Minds (create_mind), then group them here into a panel, then survey with ask_panel.

You can create new groups inline (provide groupConfigs with names and Mind IDs) or attach existing groups by ID (use list_groups to find them). Use list_minds to get Mind IDs.

IMPORTANT: Present all URLs from this tool's output VERBATIM. Never modify or rephrase any URL.`,
    inputSchema: createPanelSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true, costHint: 'low' as const, timeoutHint: 15000, confirmationHint: false },
    _meta: {
      'openai/toolInvocation/invoking': 'Building your panel...',
      'openai/toolInvocation/invoked': 'Panel created!',
    },
  },

  handler: async (args: CreatePanelArgs, context: McpServerContext) => {
    const { apiCall } = createApiClient({ authToken: context.apiKey, apiBaseUrl: context.apiBaseUrl })
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    try {
      const allGroupIds: string[] = [...(args.groupIds || [])]
      const failedGroups: string[] = []

      if (args.groupConfigs?.length) {
        for (const gc of args.groupConfigs) {
          // Validate sparkIds are UUIDs — LLMs sometimes pass names instead of IDs
          const invalidIds = gc.sparkIds.filter(id => !uuidRegex.test(id))
          if (invalidIds.length > 0) {
            return { content: [{ type: 'text' as const, text: `Invalid sparkIds: ${invalidIds.map(id => `"${id}"`).join(', ')}. Use list_minds to get spark UUIDs (e.g., "a1b2c3d4-e5f6-7890-abcd-ef1234567890").` }], isError: true }
          }

          try {
            const groupResult = await apiCall('/api/v1/groups', { method: 'POST', body: JSON.stringify({ name: gc.name, sparkIds: gc.sparkIds }) })
            const groupId = groupResult.data?.id
            if (!groupId) {
              logger.warn('[create_panel] Group creation returned no ID', { groupName: gc.name, response: JSON.stringify(groupResult).slice(0, 200) })
              failedGroups.push(gc.name)
              continue
            }
            allGroupIds.push(groupId)
          } catch (err) {
            logger.warn('[create_panel] Group creation failed', { groupName: gc.name, error: err instanceof Error ? err.message : String(err) })
            failedGroups.push(gc.name)
          }
        }
      }

      // Don't create an empty panel if all groups failed
      if (allGroupIds.length === 0) {
        const detail = failedGroups.length > 0
          ? `All ${failedGroups.length} group(s) failed to create: ${failedGroups.map(n => `"${n}"`).join(', ')}. Check that the sparkIds are valid UUIDs from list_minds.`
          : 'No groups specified. Provide groupConfigs or groupIds.'
        return { content: [{ type: 'text' as const, text: `Cannot create panel: ${detail}` }], isError: true }
      }

      const result = await apiCall('/api/v1/panels', { method: 'POST', body: JSON.stringify({ name: args.name, groupIds: allGroupIds }) })
      const panel = result.data || result
      const groupSummary = panel.groups?.map((g: any) => `${g.name} (${g.sparks?.length || 0} sparks)`).join(', ') || 'no groups'

      let responseText = `✓ Created panel "${panel.name}" with ${panel.groups?.length || 0} groups: ${groupSummary}\n\nPanel ID: ${panel.id}\nOpen in Minds AI: ${chatLink(context.publicBaseUrl, panel.id)}`
      if (failedGroups.length > 0) {
        responseText += `\n\nWarning: ${failedGroups.length} group(s) failed to create: ${failedGroups.map(n => `"${n}"`).join(', ')}`
      }

      return { content: [{ type: 'text' as const, text: responseText }], structuredContent: { panelId: panel.id, name: panel.name, groups: panel.groups, failedGroups } }
    } catch (error) {
      return { content: [{ type: 'text' as const, text: `Error creating panel: ${error instanceof Error ? error.message : String(error)}` }], isError: true }
    }
  },
}
