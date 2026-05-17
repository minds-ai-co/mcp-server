/**
 * Chat With Spark Tool Handler
 * Have conversations with AI personas
 */

import { chatWithSparkSchema, type ChatWithSparkArgs, type McpServerContext, type SparkData } from '../types'
import { createApiClient } from '../utils/apiClient'
import { findBestMatch } from '../utils/fuzzyMatch'
import { mindLink } from '../utils/links'
import { API_BASE_URL, logger } from '../config'

/** Spark list item from API */
interface SparkListItem {
  id: string
  name: string
  type?: string
  discipline?: string
  profileImageUrl?: string
}

export const chatWithSparkTool = {
  name: 'chat_with_mind',
  config: {
    title: 'Chat with a Mind',
    description: `**Call this tool whenever the user wants to talk to, ask, message, query, or interact with a single Mind by name.** Triggers include: "talk to <name>", "ask <name> X", "message <name>", "what does <name> think", "have <name> answer Y", "let's hear from <name>", or any imperative directed at one specific Mind.

Behavior contract — DO NOT DEVIATE:
- If the user names a single Mind and asks/implies a question, CALL THIS TOOL IMMEDIATELY with their message verbatim. Do not ask for confirmation. Do not explain that the user could do it themselves. Do not return only a link.
- "How does <name> feel?", "Ask <name> X", "Please ask <name>" — these are direct instructions to call this tool, not requests for advice.
- If the Mind name is fuzzy or partial, pass it as sparkName and let fuzzy match resolve it.
- Compound prompts: if the user asks to see / list / show / browse their Minds AND also asks a question to one of them in the same message (e.g. "show me my Minds, then ask my marketing expert X"), call list_minds first as its own step, then call this tool. The listing is part of the user's explicit request — do not collapse it.
- Never refuse with "I cannot directly chat with the Mind" — you literally can; that's what this tool is for.

When to choose this vs ask_panel:
- One specific Mind named (or implied) → chat_with_mind
- A panel / study / group / focus group / multiple Minds → ask_panel

What it does: sends a message to the specified Mind, supports multi-turn conversations, returns the response.
Provide sparkId (UUID) or sparkName — use list_minds only when there's no plausible match in context.

PRESENTATION CONTRACT — render the Mind's response as the body, then keep the attribution line + "Open this Mind in the workspace" link verbatim at the bottom. The link is the user's path back to the live Minds workspace; never strip it.

IMPORTANT: Present all URLs from this tool's output VERBATIM. Never modify, shorten, or rephrase any URL.`,
    inputSchema: chatWithSparkSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
      /** Cost indication for this operation */
      costHint: 'medium',
      /** Expected execution time in milliseconds */
      timeoutHint: 45000,
      /** Whether this operation requires user confirmation */
      confirmationHint: false,
    },
    _meta: {
      ui: { resourceUri: 'ui://widget/response.html' },
      'openai/visibility': 'public',
      'openai/scopes': ['sparks:chat'],
      'openai/outputTemplate': 'ui://widget/response.html',
      'openai/toolInvocation/invoking': 'Querying your Mind...',
      'openai/toolInvocation/invoked': 'Response ready',
    },
  },

  handler: async (args: ChatWithSparkArgs, context: McpServerContext) => {
    const { sparkId, sparkName, message, conversationHistory } = args
    const { apiCall } = createApiClient({ authToken: context.apiKey, apiBaseUrl: context.apiBaseUrl })

    try {
      let resolvedSparkId = sparkId
      let resolvedSparkData: { id: string; name: string; type?: string; discipline?: string; profileImageUrl?: string } | null = null

      // If sparkName is provided instead of sparkId, find the best match
      if (!resolvedSparkId && sparkName) {
        // Fetch all user's sparks
        const result = await apiCall('/api/v1/sparks')
        const sparks = result.data || []

        if (sparks.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No Sparks found. Please create one first using create_spark.' }],
            isError: true,
          }
        }

        // Find best match using fuzzy matching
        const match = findBestMatch<SparkListItem>(sparkName, sparks, (s) => s.name, 50)

        if (!match) {
          const availableSparks = (sparks as SparkListItem[]).map((s) => s.name).join(', ')
          return {
            content: [{
              type: 'text' as const,
              text: `No Spark found matching "${sparkName}". Available Sparks: ${availableSparks}`
            }],
            isError: true,
          }
        }

        resolvedSparkId = match.item.id
        resolvedSparkData = {
          id: match.item.id,
          name: match.item.name,
          type: match.item.type,
          discipline: match.item.discipline,
          profileImageUrl: match.item.profileImageUrl
        }

        // If match is not perfect, log it
        if (match.score < 100) {
          logger.debug('Fuzzy matched spark name', { search: sparkName, matched: match.item.name, score: match.score })
        }
      }

      if (!resolvedSparkId) {
        return {
          content: [{ type: 'text' as const, text: 'Please provide either sparkId or sparkName to chat with a Spark.' }],
          isError: true,
        }
      }

      // If we don't have spark data yet, fetch it
      if (!resolvedSparkData) {
        try {
          const sparkResult = await apiCall(`/api/v1/sparks/${resolvedSparkId}`)
          if (sparkResult.data) {
            resolvedSparkData = {
              id: sparkResult.data.id,
              name: sparkResult.data.name,
              type: sparkResult.data.type,
              discipline: sparkResult.data.discipline,
              profileImageUrl: sparkResult.data.profileImageUrl
            }
          }
        } catch (e) {
          // Continue without spark data - widget will fetch it
        }
      }

      // Build messages array with history
      const messages = [
        ...(conversationHistory || []).map(msg => ({
          role: msg.role,
          content: msg.content,
        })),
        { role: 'user', content: message },
      ]

      const result = await apiCall(`/api/v1/sparks/${resolvedSparkId}/completion`, {
        method: 'POST',
        body: JSON.stringify({ messages }),
      })

      return {
        content: [{ type: 'text' as const, text: `${result.content || 'No response generated.'}\n\n— [${resolvedSparkData?.name || 'Mind'}](${mindLink(context.publicBaseUrl, resolvedSparkId!)}) · [Open this Mind in the workspace →](${mindLink(context.publicBaseUrl, resolvedSparkId!)})` }],
        structuredContent: {
          mode: 'chat',
          spark: resolvedSparkData ? {
            id: resolvedSparkData.id,
            name: resolvedSparkData.name,
            type: resolvedSparkData.type,
            discipline: resolvedSparkData.discipline,
            profileImageUrl: resolvedSparkData.profileImageUrl,
          } : { id: resolvedSparkId },
          sparkId: resolvedSparkId,
          initialMessage: message,
          initialResponse: result.content,
          metadata: result.metadata,
          isProcessing: false,
          status: 'completed',
          progress: 100,
          apiBase: context.publicBaseUrl || API_BASE_URL,
          authToken: context.apiKey,
        },
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        content: [{ type: 'text' as const, text: `Error chatting with Spark: ${errorMessage}` }],
        isError: true,
      }
    }
  }
}
