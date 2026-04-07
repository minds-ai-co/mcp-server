/**
 * Chat With Spark Tool Handler
 * Have conversations with AI personas
 */

import { chatWithSparkSchema, type ChatWithSparkArgs, type McpServerContext, type SparkData } from '../types'
import { createApiClient } from '../utils/apiClient'
import { findBestMatch } from '../utils/fuzzyMatch'
import { mindLink } from '../utils/links'
import { logger } from '../config'

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
    description: `Send a message to one of the user's Minds and get a response. Use this for 1:1 conversations with a single Mind — for surveying multiple Minds at once, use ask_panel instead.

Supports multi-turn conversations and fuzzy name matching (e.g., "my marketing expert").
Provide sparkId (UUID) or sparkName — use list_minds to find available Minds.

IMPORTANT: Present all URLs from this tool's output VERBATIM. Never modify or rephrase any URL.`,
    inputSchema: chatWithSparkSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
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
        content: [{ type: 'text' as const, text: `${result.content || 'No response generated.'}\n\n—\n*${resolvedSparkData?.name || 'Mind'}* · ${mindLink(context.publicBaseUrl, resolvedSparkId!)}` }],
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
