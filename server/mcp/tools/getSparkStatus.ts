/**
 * Get Spark Status Tool Handler
 * Check training progress for AI personas
 */

import { getSparkStatusSchema, type GetSparkStatusArgs, type McpServerContext } from '../types'
import { pollSparkStatus } from '../utils/apiClient'
import { API_BASE_URL, logger } from '../config'

export const getSparkStatusTool = {
  name: 'check_ai_persona_training_progress',
  config: {
    title: 'Check AI Persona Training Progress',
    description: `Check the training status and progress of an AI persona being created. Use this when:
- The user wants to know if their AI persona is ready
- Checking the progress of a digital twin being trained
- Waiting for an AI expert to finish learning its knowledge base
- The user asks "is my AI ready?" or "how is my persona doing?"

Returns real-time progress updates including percentage complete and current training stage.`,
    inputSchema: getSparkStatusSchema,
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
      'openai/outputTemplate': 'ui://widget/spark.html',
      'openai/widgetAccessible': true,
    },
  },

  handler: async (args: GetSparkStatusArgs, context: McpServerContext) => {
    const { sparkId } = args
    const effectiveApiUrl = context.apiBaseUrl || API_BASE_URL

    try {
      // Use the demo-state endpoint for richer progress data
      const statusResult = await pollSparkStatus(sparkId, 1)

      const isReady = statusResult.status === 'completed' || statusResult.status === 'idle'

      // Also fetch spark details for the widget
      let spark = null
      try {
        const sparkResponse = await fetch(`${effectiveApiUrl}/api/public/spark/${sparkId}/demo-state?_t=${Date.now()}`)
        if (sparkResponse.ok) {
          const data = await sparkResponse.json()
          spark = data.spark
        }
      } catch (e) {
        logger.warn('Failed to fetch spark details', { sparkId: sparkId.slice(0, 8) + '...', error: e instanceof Error ? e.message : String(e) })
      }

      return {
        content: [{
          type: 'text',
          text: isReady
            ? `✓ Spark is ready to chat!`
            : `Spark status: ${statusResult.status} (${statusResult.progress}%) - ${statusResult.message}`,
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
        content: [{ type: 'text', text: `Error checking status: ${errorMessage}` }],
        isError: true,
      }
    }
  }
}
