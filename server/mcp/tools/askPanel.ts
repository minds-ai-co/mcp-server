/**
 * Ask Panel Tool — submits a survey question, returns immediately.
 *
 * The SSE stream runs in the background. Use get_panel_status to
 * track which Minds have answered and get final results.
 */
import type { McpServerContext } from '../types'
import { askPanelSchema } from '../types'
import { createApiClient } from '../utils/apiClient'
import { findBestMatch } from '../utils/fuzzyMatch'
import { API_BASE_URL, logger } from '../config'
import { chatLink } from '../utils/links'
import {
  createPendingQuestion,
  updateTotal,
  addAnswer,
  markAggregating,
  markCompleted,
  markFailed,
} from '../utils/pendingQuestions'

interface AskPanelArgs { panelId?: string; panelName?: string; question: string; groupIds?: string[] }

export const askPanelTool = {
  name: 'ask_panel',
  config: {
    title: 'Ask a Panel',
    description: `Submit a research question to a panel. Returns immediately — each Mind answers in the background.

Use get_panel_status to track progress (which Minds have answered) and get the final aggregated results.

Questions are auto-classified as:
- Scale (e.g., "Rate 1-10...") → mean, distribution per group
- Categorical (e.g., "Which channel...") → dominant choice per group
- Qualitative (e.g., "What trends...") → themed responses per group

Requires an existing panel — use create_panel first, or list_panels to find one.`,
    inputSchema: askPanelSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, costHint: 'medium' as const, timeoutHint: 15000, confirmationHint: false },
    _meta: {
      ui: { resourceUri: 'ui://widget/response.html' },
      'openai/outputTemplate': 'ui://widget/response.html',
    },
  },

  handler: async (args: AskPanelArgs, context: McpServerContext) => {
    const { apiCall } = createApiClient({ authToken: context.apiKey, apiBaseUrl: context.apiBaseUrl })
    try {
      // Resolve panel ID
      let resolvedPanelId = args.panelId
      if (!resolvedPanelId && args.panelName) {
        const panels = await apiCall('/api/v1/panels')
        const list = panels.data || []
        if (!list.length) return { content: [{ type: 'text' as const, text: 'No panels found. Create one first.' }], isError: true }
        const match = findBestMatch(args.panelName, list, (p: any) => p.name, 50)
        if (!match) return { content: [{ type: 'text' as const, text: `No panel matching "${args.panelName}". Available: ${list.map((p: any) => p.name).join(', ')}` }], isError: true }
        resolvedPanelId = match.item.id
      }
      if (!resolvedPanelId) return { content: [{ type: 'text' as const, text: 'Provide panelId or panelName.' }], isError: true }

      // Create tracking entry
      const pending = createPendingQuestion(resolvedPanelId, args.question)

      // Store panel ID in session context so the widget resource can use it
      context.setLatestPanel(resolvedPanelId)

      // Fire SSE request in the background — don't await
      const baseUrl = context.apiBaseUrl || API_BASE_URL
      processSSEInBackground(pending.questionId, `${baseUrl}/api/v1/panels/${resolvedPanelId}/ask`, {
        question: args.question,
        groupIds: args.groupIds,
      }, context.apiKey)

      return {
        content: [{
          type: 'text' as const,
          text: `Survey started (question: "${args.question.slice(0, 80)}${args.question.length > 80 ? '...' : ''}"). Use get_panel_status to track progress and get results.\n\nOpen in Minds AI: ${chatLink(context.publicBaseUrl, resolvedPanelId)}`,
        }],
        structuredContent: {
          questionId: pending.questionId,
          panelId: resolvedPanelId,
          question: args.question,
          status: 'processing',
        },
      }
    } catch (error) {
      return { content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true }
    }
  },
}

/**
 * Process the SSE stream in the background, updating the pending question
 * tracker as events arrive. Runs detached from the tool handler.
 */
function processSSEInBackground(
  questionId: string,
  url: string,
  body: { question: string; groupIds?: string[] },
  apiKey: string,
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 180_000) // 3 min max

  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .then(async (response) => {
      clearTimeout(timeout)
      if (!response.ok) {
        const errBody = await response.text().catch(() => '')
        let detail = errBody.slice(0, 200)
        try { const p = JSON.parse(errBody); detail = p.statusMessage || p.message || detail } catch {}
        markFailed(questionId, `HTTP ${response.status}: ${detail}`)
        return
      }

      // Parse SSE stream line by line
      const text = await response.text()
      let currentData = ''

      for (const line of text.split('\n')) {
        if (line.startsWith('data: ')) {
          currentData += line.slice(6)
        } else if (line === '' && currentData) {
          try {
            const event = JSON.parse(currentData)
            switch (event.type) {
              case 'start':
                updateTotal(questionId, event.total || 0)
                break
              case 'answer':
                addAnswer(questionId, {
                  sparkName: event.sparkName || event.persona || 'Unknown',
                  groupName: event.groupName || event.group || '',
                  value: event.answer || event.value || '',
                  discipline: event.discipline,
                })
                break
              case 'aggregating':
                markAggregating(questionId)
                break
              case 'result':
                markCompleted(questionId, event.outputData)
                break
            }
          } catch {}
          currentData = ''
        }
      }
      // Handle trailing data without empty line
      if (currentData) {
        try {
          const event = JSON.parse(currentData)
          if (event.type === 'result') markCompleted(questionId, event.outputData)
        } catch {}
      }

      // If we never got a result event, mark as failed
      const q = (await import('../utils/pendingQuestions')).getQuestion(questionId)
      if (q && q.status !== 'completed') {
        markFailed(questionId, 'Stream ended without results')
      }
    })
    .catch((err) => {
      clearTimeout(timeout)
      const msg = err.name === 'AbortError' ? 'Question timed out after 3 minutes' : err.message
      markFailed(questionId, msg)
      logger.warn('[ask_panel] Background SSE failed', { questionId, error: msg })
    })
}
