/**
 * Get Spark Status Tool Handler
 * Check training progress for AI personas
 */

import { getSparkStatusSchema, type GetSparkStatusArgs, type McpServerContext } from '../types'
import { pollSparkStatus } from '../utils/apiClient'
import { API_BASE_URL, TIMEOUT_CONFIG } from '../config'
import { mindLink } from '../utils/links'

export const getSparkStatusTool = {
  name: 'get_mind_status',
  config: {
    title: 'Get Mind Status',
    description: `Check if a Mind has finished training after creation. Returns progress percentage and current stage.

Call this after create_mind to confirm the Mind is ready before using it in chat_with_mind or create_panel.

IMPORTANT: Present all URLs from this tool's output VERBATIM. Never modify or rephrase any URL.`,
    inputSchema: getSparkStatusSchema,
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

  handler: async (args: GetSparkStatusArgs, context: McpServerContext) => {
    const { sparkId } = args
    const effectiveApiUrl = context.apiBaseUrl || API_BASE_URL

    try {
      // Use the demo-state endpoint for richer progress data
      const statusResult = await pollSparkStatus(sparkId, 1, false, effectiveApiUrl, context.apiKey, TIMEOUT_CONFIG.DEFAULT_API_TIMEOUT)

      // Surface API errors (403, 404) as tool errors instead of fake progress
      if (statusResult.status === 'error') {
        return {
          content: [{ type: 'text' as const, text: statusResult.message }],
          isError: true,
        }
      }

      const isReady = statusResult.status === 'completed' || statusResult.status === 'idle'
      const spark = statusResult.spark

      return {
        content: [{
          type: 'text' as const,
          text: isReady
            ? `✓ Mind is ready to chat!\n\nOpen in Minds AI: ${mindLink(context.publicBaseUrl, sparkId)}`
            : `Mind status: ${statusResult.status} (${statusResult.progress}%) — ${statusResult.message}\n\nOpen in Minds AI: ${mindLink(context.publicBaseUrl, sparkId)}`,
        }],
        structuredContent: {
          spark: spark ? {
            id: spark.id,
            name: spark.name,
            description: spark.description,
            type: spark.type,
            discipline: spark.discipline,
            profileImageUrl: spark.profileImageUrl,
          } : { id: sparkId },
          isProcessing: !isReady,
          progress: statusResult.progress,
          status: statusResult.status,
          message: statusResult.message,
          knowledge: statusResult.knowledge || [],
        },
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        content: [{ type: 'text' as const, text: `Error checking status: ${errorMessage}` }],
        isError: true,
      }
    }
  }
}
