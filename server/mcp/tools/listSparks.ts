/**
 * List Sparks Tool Handler
 * Lists all AI personas for the authenticated user
 */

import { listSparksSchema, type ListSparksArgs, type McpServerContext, type SparkData } from '../types'
import { createApiClient } from '../utils/apiClient'
import { mindLink, workspaceLink } from '../utils/links'

/** Spark list item for display */
interface SparkListItem {
  id: string
  name: string
  description?: string
  type?: string
  discipline?: string
  profileImageUrl?: string
}

export const listSparksTool = {
  name: 'list_minds',
  config: {
    title: 'List Minds',
    description: `List all Minds the user has created. A Mind is a synthetic expert, consumer persona, or digital twin trained on specific topics or data.

Use this to browse existing Minds, search by name, or get Mind IDs needed for create_panel.
Supports fuzzy name search.`,
    inputSchema: listSparksSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      /** Cost indication for this operation */
      costHint: 'low',
      /** Expected execution time in milliseconds */
      timeoutHint: 10000,
      /** Whether this operation requires user confirmation */
      confirmationHint: false,
    },
    _meta: {
      'openai/visibility': 'public',
      'openai/scopes': ['sparks:read'],
    },
  },

  handler: async (args: ListSparksArgs, context: McpServerContext) => {
    const { searchQuery } = args
    const { apiCall } = createApiClient({ authToken: context.apiKey, apiBaseUrl: context.apiBaseUrl })

    try {
      // Build URL with search query parameter if provided
      const url = searchQuery
        ? `/api/v1/sparks?search=${encodeURIComponent(searchQuery)}`
        : '/api/v1/sparks'

      const result = await apiCall(url)
      const sparks: SparkListItem[] = result.data || []

      // Format response for the model
      const sparkList: SparkListItem[] = sparks.map((spark) => ({
        id: spark.id,
        name: spark.name,
        description: spark.description,
        type: spark.type,
        discipline: spark.discipline,
        profileImageUrl: spark.profileImageUrl,
      }))

      return {
        content: [{
          type: 'text' as const,
          text: sparks.length > 0
            ? `Found ${sparks.length} Mind(s):\n${sparkList.map((s) => `- **${s.name}** (${s.type || 'expert'}): ${s.description || 'No description'}\n  ID: ${s.id} · ${mindLink(context.publicBaseUrl, s.id)}`).join('\n')}\n\nOpen in Minds AI: ${workspaceLink(context.publicBaseUrl)}`
            : `No Minds found. Create one using create_mind.\n\nOpen Minds AI: ${workspaceLink(context.publicBaseUrl)}`,
        }],
        structuredContent: { sparks: sparkList },
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        content: [{ type: 'text' as const, text: `Error listing Sparks: ${errorMessage}` }],
        isError: true,
      }
    }
  }
}
