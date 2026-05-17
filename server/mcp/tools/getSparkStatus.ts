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
    description: `**Call this tool whenever the user wants to check progress / status / readiness of a Mind / persona / digital twin / expert that's still training.** Triggers include: "is <Mind> ready?", "how's <persona> coming along?", "training progress for <name>", "did the Mind finish?".

Returns progress percentage, current training stage, and a link to open the Mind in the workspace. Call this after create_mind to confirm the Mind is ready before using it in chat_with_mind or create_panel.

You MUST include the returned Mind URL (structuredContent.url or the resource_link) in your reply to the user, verbatim. It is the user's path back to the live Minds workspace.`,
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
      const sparkUrl = mindLink(context.publicBaseUrl, sparkId)

      const sparkName = spark?.name
      const linkedName = sparkName ? `[${sparkName}](${sparkUrl})` : `[this Mind](${sparkUrl})`
      const displayName = sparkName || 'this Mind'
      return {
        content: [
          {
            type: 'text' as const,
            text: isReady
              ? `✓ ${linkedName} is ready to chat!\n\n[Open this Mind in the workspace →](${sparkUrl})`
              : `${linkedName} — ${statusResult.status} (${statusResult.progress}%): ${statusResult.message}\n\n[Open this Mind in the workspace →](${sparkUrl})`,
          },
          { type: 'resource_link' as const, uri: sparkUrl, name: `Open ${displayName}`, description: 'Open this Mind in the Minds workspace', mimeType: 'text/html', annotations: { audience: ['user'], priority: 1.0 } },
        ],
        structuredContent: {
          spark: spark ? {
            id: spark.id,
            name: spark.name,
            description: spark.description,
            type: spark.type,
            discipline: spark.discipline,
            profileImageUrl: spark.profileImageUrl,
            url: sparkUrl,
          } : { id: sparkId, url: sparkUrl },
          url: sparkUrl,
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
