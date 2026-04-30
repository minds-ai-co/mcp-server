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
    description: `**Call this tool whenever the user wants to list / show / see / browse / find their Minds.** Triggers include: "list my minds", "show my personas", "what experts do I have", "my digital twins", "my consumers", "my respondents", "my characters", "my profiles", "my AI agents".

Behavior contract — DO NOT DEVIATE:
- The user's Minds belong to them and are accessible via this tool. CALL IT IMMEDIATELY whenever the user asks any of the above. Do not ask for confirmation.
- Never refuse with "I cannot access your Minds / personal data" — you literally can; that is the entire purpose of this tool.
- For multi-Mind research conversations (panels, studies, surveys, focus groups), use list_panels instead.

A Mind is a synthetic expert, consumer persona, or digital twin trained on specific topics or data. Users may also refer to Minds as: personas, AI personas, experts, digital twins, consumers, respondents, characters, agents, profiles, or simply "people".

Use this to browse existing Minds, search by name, or get Mind IDs needed for create_panel. Supports fuzzy name search.

IMPORTANT: Present all URLs from this tool's output VERBATIM. Never modify, shorten, or rephrase any URL. Copy each link exactly as returned — they contain encoded parameters that break if changed.`,
    inputSchema: listSparksSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
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

      const sparkList: SparkListItem[] = sparks.map((spark) => ({
        id: spark.id,
        name: spark.name,
        description: spark.description,
        type: spark.type,
        discipline: spark.discipline,
        profileImageUrl: spark.profileImageUrl,
      }))

      // Truncate the rendered table — 100+ rows would blow the LLM's context
      // and produce unwieldy chat output. The full list still ships in
      // structuredContent for clients that can paginate richly.
      const RENDER_LIMIT = 20
      const shown = sparkList.slice(0, RENDER_LIMIT)
      const more = sparkList.length - shown.length

      const tableHeader = '| Mind | Discipline | Link |\n|------|-----------|------|'
      const tableRows = shown.map((s) => `| ${s.name} | ${s.discipline || '—'} | [Open](${mindLink(context.publicBaseUrl, s.id)}) |`).join('\n')
      const moreLine = more > 0
        ? `\n\n_Showing ${shown.length} of ${sparkList.length}. ${more} more not shown — narrow with searchQuery, or [browse all in the workspace →](${workspaceLink(context.publicBaseUrl)})._`
        : ''
      const emptyMsg = searchQuery
        ? `No Minds matching "${searchQuery}". Try a different search, or [browse all in the workspace →](${workspaceLink(context.publicBaseUrl)}).`
        : `No Minds yet. Create one with create_mind.\n\n[Open the workspace →](${workspaceLink(context.publicBaseUrl)})`

      return {
        content: [{
          type: 'text' as const,
          text: sparks.length > 0
            ? `Found ${sparks.length} Mind${sparks.length === 1 ? '' : 's'}:\n\n${tableHeader}\n${tableRows}${moreLine}\n\n[Open the workspace →](${workspaceLink(context.publicBaseUrl)})`
            : emptyMsg,
        }],
        structuredContent: { sparks: sparkList, totalCount: sparkList.length, shownCount: shown.length },
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
