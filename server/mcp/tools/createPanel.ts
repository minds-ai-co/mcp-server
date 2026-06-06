/**
 * Create Panel Tool - creates a panel survey with groups of AI sparks
 */
import type { McpServerContext } from '../types'
import { createPanelSchema } from '../types'
import { createApiClient } from '../utils/apiClient'
import { logger } from '../config'
import { chatLink, sharedPanelLink } from '../utils/links'

interface CreatePanelArgs {
  name: string
  groupConfigs?: Array<{ name?: string; mindIds?: string[]; sparkIds?: string[] }>
  groupIds?: string[]
}

export const createPanelTool = {
  name: 'create_panel',
  config: {
    title: 'Create a Panel',
    description: `**Call this tool whenever the user wants to start, set up, build, launch, or create a panel / study / survey / research project / focus group / qual study.** Triggers include: "start a study", "set up a survey", "create a focus group", "launch research on X", "build me a panel", "I want to ask a panel about Y" (when no panel matches yet).

Behavior contract — DO NOT DEVIATE:
- If the user describes a research goal and a panel doesn't exist yet, CALL THIS TOOL. Don't lecture them on the workflow first.
- Only ask for clarification if you're missing something concrete (a name, or which Minds/groups go in).
- Never refuse with "I cannot create a panel directly" — you literally can.

A panel contains one or more groups of Minds surveyed together for comparative analysis.

Workflow: first create Minds (create_mind), then group them here into a panel, then survey with ask_panel.

You can create new groups inline (provide groupConfigs with names and Mind IDs) or attach existing groups by ID (use list_groups to find them). Use list_minds to get Mind IDs.

CUSTOMER HANDOFF CONTRACT — this tool always creates a public shared panel link. For external/customer/respondent handoff, use ONLY the shared panel link returned by this tool. Do not invite the recipient, add them as a member/collaborator, create flow_members/spark_group_user_members records, or tell them it was added to their account unless the human explicitly asks for account collaboration.

PRESENTATION CONTRACT — preserve the shared panel link and owner workspace link in the response verbatim. The shared panel link is for customers/respondents; the workspace link is only for the authenticated creator.

IMPORTANT: Present all URLs from this tool's output VERBATIM. Never modify, shorten, or rephrase any URL.`,
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
        for (const [index, gc] of args.groupConfigs.entries()) {
          // Accept mindIds (canonical) or sparkIds (legacy alias). Name is optional —
          // ChatGPT submission TCs call create_panel with just mindIds and no name.
          const mindIds = gc.mindIds ?? gc.sparkIds ?? []
          const groupName = gc.name?.trim() || `Group ${index + 1}`

          if (mindIds.length === 0) {
            return { content: [{ type: 'text' as const, text: `Group "${groupName}" needs at least one Mind. Provide mindIds (use list_minds to find IDs).` }], isError: true }
          }

          // Validate IDs are UUIDs — LLMs sometimes pass names instead of IDs
          const invalidIds = mindIds.filter(id => !uuidRegex.test(id))
          if (invalidIds.length > 0) {
            return { content: [{ type: 'text' as const, text: `Invalid mindIds: ${invalidIds.map(id => `"${id}"`).join(', ')}. Use list_minds to get Mind UUIDs (e.g., "a1b2c3d4-e5f6-7890-abcd-ef1234567890").` }], isError: true }
          }

          try {
            // Internal /api/v1/groups still keys on sparkIds — only the public MCP input aliases to mindIds.
            const groupResult = await apiCall('/api/v1/groups', {
              method: 'POST',
              body: JSON.stringify({ name: groupName, sparkIds: mindIds, isLinkSharingEnabled: true }),
            })
            const groupId = groupResult.data?.id
            if (!groupId) {
              logger.warn('[create_panel] Group creation returned no ID', { groupName, response: JSON.stringify(groupResult).slice(0, 200) })
              failedGroups.push(groupName)
              continue
            }
            allGroupIds.push(groupId)
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err)
            logger.warn('[create_panel] Group creation failed', { groupName, error: errMsg })
            failedGroups.push(`${groupName} (${errMsg})`)
          }
        }
      }

      // Don't create an empty panel if all groups failed
      if (allGroupIds.length === 0) {
        const detail = failedGroups.length > 0
          ? `All ${failedGroups.length} group(s) failed to create: ${failedGroups.map(n => `"${n}"`).join(', ')}. Check that the mindIds are valid UUIDs from list_minds.`
          : 'No groups specified. Provide groupConfigs or groupIds.'
        return { content: [{ type: 'text' as const, text: `Cannot create panel: ${detail}` }], isError: true }
      }

      const result = await apiCall('/api/v1/panels', { method: 'POST', body: JSON.stringify({ name: args.name, groupIds: allGroupIds, isLinkSharingEnabled: true }) })
      const panel = result.data || result
      const groupSummary = panel.groups?.map((g: any) => `${g.name} (${g.sparks?.length || 0} sparks)`).join(', ') || 'no groups'
      const workspaceUrl = chatLink(context.publicBaseUrl, panel.id)
      const customerShareUrl = panel.publicShareId ? sharedPanelLink(context.publicBaseUrl, panel.publicShareId) : null

      let responseText = `✓ Created panel **${panel.name}** with ${panel.groups?.length || 0} group${(panel.groups?.length || 0) === 1 ? '' : 's'}: ${groupSummary}`
      if (customerShareUrl) {
        responseText += `\n\nCustomer share link (use this for external recipients; do not add them to an account): ${customerShareUrl}`
      } else {
        responseText += '\n\nCustomer share link was not returned. Do not send the workspace link to external recipients.'
      }
      responseText += `\n\nOwner workspace link: ${workspaceUrl}`
      if (failedGroups.length > 0) {
        responseText += `\n\n⚠️ ${failedGroups.length} group(s) failed to create: ${failedGroups.map(n => `"${n}"`).join(', ')}`
      }

      return {
        content: [{ type: 'text' as const, text: responseText }],
        structuredContent: {
          panelId: panel.id,
          name: panel.name,
          groups: panel.groups,
          failedGroups,
          isLinkSharingEnabled: panel.isLinkSharingEnabled === true,
          publicShareId: panel.publicShareId || null,
          sharedPanelUrl: customerShareUrl,
          workspaceUrl,
        },
      }
    } catch (error) {
      return { content: [{ type: 'text' as const, text: `Error creating panel: ${error instanceof Error ? error.message : String(error)}` }], isError: true }
    }
  },
}
