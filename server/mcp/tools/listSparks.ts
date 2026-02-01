/**
 * List Sparks Tool Handler
 * Lists all AI personas for the authenticated user
 */

import { listSparksSchema, type ListSparksArgs, type McpServerContext, type SparkData } from '../types'
import { createApiClient } from '../utils/apiClient'

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
  name: 'list_my_ai_personas',
  config: {
    title: 'List My AI Personas & Digital Twins',
    description: `List all AI personas, digital twins, and expert advisors you've created. Use this when the user wants to:
- See their existing AI assistants or personas
- Find a specific expert they created before
- Check what digital twins they have available
- Browse their AI advisor collection
Supports fuzzy search by name to quickly find the right persona.`,
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
          type: 'text',
          text: sparks.length > 0
            ? `Found ${sparks.length} Spark(s):\n${sparkList.map((s) => `- ${s.name} (${s.type}): ${s.description || 'No description'}`).join('\n')}`
            : 'No Sparks found. You can create one using the create_spark tool.',
        }],
        structuredContent: { sparks: sparkList },
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        content: [{ type: 'text', text: `Error listing Sparks: ${errorMessage}` }],
        isError: true,
      }
    }
  }
}
