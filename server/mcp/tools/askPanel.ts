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
import { chatLink, sharedPanelLink } from '../utils/links'
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
    description: `**Call this tool whenever the user wants to ask, survey, poll, query, or have any panel / study / focus group respond to anything.** Triggers: "ask my panel X", "survey my panel about Y", "what does <panel> think", "how is <panel> feeling", "ask the group", "poll them", "let's hear from <panel>", "ask the panel <name> if they prefer X or Y".

Behavior contract — DO NOT DEVIATE:
- If the user names a panel and asks/implies a question, CALL THIS TOOL IMMEDIATELY with their question verbatim. Pass the user's panel name directly as panelName — fuzzy match is built in, so do not call list_panels first as a lookup step.
- Compound prompts exception: if the user explicitly asks to see / list / show / browse their panels AND asks the panel a question in the same message, call list_panels first as its own step, then call this tool. The listing is part of the user's explicit request — do not collapse it.
- "How are they feeling?", "What do they think?", "Ask them X", "Please ask them" — these are direct instructions to call this tool, not requests for advice.
- AFTER calling this tool, the question HAS BEEN ASKED. Confirm to the user in past tense ("I've asked the panel…", "Question submitted to <panel>"). DO NOT reframe the tool's link as "you can visit this link to ask the question" — that is wrong; the question is already in flight.
- Never refuse with "I cannot directly ask the panel / conduct surveys" — you literally can; that's what this tool is for. The user EXPLICITLY asked you to call it; refusing is a bug, not safety.

What it does: submits the user's question to the panel. Returns immediately — each Mind answers asynchronously. Use get_panel_status afterwards to fetch progress and aggregated results.

Question types are auto-classified:
- Scale ("Rate 1-10...") → mean, distribution per group
- Categorical ("Which channel...") → dominant choice per group
- Qualitative ("What trends...", "How are you feeling?") → themed responses per group

Requires an existing panel — call create_panel first if none exists, or list_panels to disambiguate.

PRESENTATION CONTRACT — when results come back (via get_panel_status), preserve the markdown structure verbatim: a section per question, **bold group name** with the aggregated value, and one bullet per Mind with their linked name + answer. This mirrors the PanelAnswerBlock widget. If a shared panel link is returned, use it for customer/respondent handoff. The workspace link is only for the authenticated creator.

IMPORTANT: Present all URLs from this tool's output VERBATIM. Never modify, shorten, or rephrase any URL. Always show every Mind link and the panel links.`,
    inputSchema: askPanelSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true, costHint: 'medium' as const, timeoutHint: 15000, confirmationHint: false },
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

      let customerShareUrl: string | null = null
      try {
        const panelDetail = await apiCall(`/api/v1/panels/${resolvedPanelId}`)
        const data = panelDetail.data || panelDetail
        customerShareUrl = data.publicShareId ? sharedPanelLink(context.publicBaseUrl, data.publicShareId) : null
      } catch {}

      // Fire SSE request in the background — don't await
      const baseUrl = context.apiBaseUrl || API_BASE_URL
      processSSEInBackground(pending.questionId, `${baseUrl}/api/v1/panels/${resolvedPanelId}/ask`, {
        question: args.question,
        groupIds: args.groupIds,
      }, context.apiKey)

      return {
        content: [{
          type: 'text' as const,
          text: `✓ Question submitted to the panel. The Minds are answering now: _"${args.question}"_\n\nTell the user the question has been asked (past tense). Use get_panel_status next to fetch the aggregated results when they're ready.`
            + (customerShareUrl ? `\n\nCustomer share link: ${customerShareUrl}` : '')
            + `\n\n[View live progress in the Minds workspace →](${chatLink(context.publicBaseUrl, resolvedPanelId)})`,
        }],
        structuredContent: {
          questionId: pending.questionId,
          panelId: resolvedPanelId,
          question: args.question,
          status: 'processing',
          sharedPanelUrl: customerShareUrl,
          workspaceUrl: chatLink(context.publicBaseUrl, resolvedPanelId),
          apiBase: context.publicBaseUrl || API_BASE_URL,
          authToken: context.apiKey,
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
