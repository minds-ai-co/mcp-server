/**
 * Get Panel Status Tool Handler
 *
 * Unified progress view: panel detail, in-progress questions,
 * completed question history, and export job status.
 */

import { getPanelStatusSchema, type GetPanelStatusArgs, type McpServerContext } from '../types'
import { createApiClient } from '../utils/apiClient'
import { findBestMatch } from '../utils/fuzzyMatch'
import { getPanelQuestions, type PendingQuestion } from '../utils/pendingQuestions'
import { chatLink } from '../utils/links'

export const getPanelStatusTool = {
  name: 'get_panel_status',
  config: {
    title: 'Get Panel Status',
    description: `Check the status of a panel — including live progress on in-flight questions.

Returns:
- Panel info (groups, Minds)
- Active questions: which Minds have answered so far, how many remain
- Completed question results (aggregated)
- PDF export status (if any)

Call this after ask_panel to track progress, or after export_panel with format "pdf" to check if the download is ready.`,
    inputSchema: getPanelStatusSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      costHint: 'low' as const,
      timeoutHint: 15000,
      confirmationHint: false,
    },
    _meta: {
      'openai/visibility': 'public',
      'openai/scopes': ['flows:read'],
      ui: { resourceUri: 'ui://widget/response.html' },
      'openai/outputTemplate': 'ui://widget/response.html',
    },
  },

  handler: async (args: GetPanelStatusArgs, context: McpServerContext) => {
    const { apiCall } = createApiClient({ authToken: context.apiKey, apiBaseUrl: context.apiBaseUrl })

    try {
      // Resolve panel ID
      let resolvedPanelId = args.panelId
      if (!resolvedPanelId && args.panelName) {
        const panels = await apiCall('/api/v1/panels')
        const list = panels.data || []
        if (!list.length) return { content: [{ type: 'text' as const, text: 'No panels found.' }], isError: true }
        const match = findBestMatch(args.panelName, list, (p: any) => p.name, 50)
        if (!match) return { content: [{ type: 'text' as const, text: `No panel matching "${args.panelName}". Available: ${list.map((p: any) => p.name).join(', ')}` }], isError: true }
        resolvedPanelId = match.item.id
      }
      if (!resolvedPanelId) return { content: [{ type: 'text' as const, text: 'Provide panelId or panelName.' }], isError: true }

      // Fetch panel detail
      const panel = await apiCall(`/api/v1/panels/${resolvedPanelId}`)
      const data = panel.data || panel

      // Check for in-progress questions
      const pendingQuestions = getPanelQuestions(resolvedPanelId)

      // Try to fetch export status (non-critical)
      let exportStatus: any = null
      try {
        const exportResult = await apiCall(`/api/v1/panels/${resolvedPanelId}/export-status`)
        exportStatus = exportResult.data || exportResult
      } catch {}

      // Format groups
      const groups = (data.groups || data.panelGroups || []).map((g: any) => {
        const group = g.group || g
        return {
          id: group.id,
          name: group.name,
          sparkCount: group.sparkCount || group.members?.length || group.sparks?.length || 0,
          sparks: (group.members || group.sparks || []).map((m: any) => {
            const spark = m.spark || m
            return { id: spark.id, name: spark.name, discipline: spark.discipline }
          }),
        }
      })

      // Build text summary
      const lines: string[] = [
        `Panel: "${data.name}"`,
        `ID: ${data.id}`,
        `Created: ${data.createdAt}`,
        `Messages: ${data.messageCount ?? data._count?.messages ?? 'unknown'}`,
        '',
        `Groups (${groups.length}):`,
      ]
      for (const g of groups) {
        lines.push(`  - "${g.name}" (${g.sparkCount} Mind(s))`)
        for (const s of g.sparks) {
          lines.push(`    - ${s.name}${s.discipline ? ` (${s.discipline})` : ''}`)
        }
      }

      // Show pending/active questions
      const activeQuestions = pendingQuestions.filter(q => q.status === 'processing' || q.status === 'aggregating')
      const recentCompleted = pendingQuestions.filter(q => q.status === 'completed')
      const failed = pendingQuestions.filter(q => q.status === 'failed')

      if (activeQuestions.length > 0) {
        lines.push('')
        for (const q of activeQuestions) {
          const progress = q.totalMinds > 0
            ? `${q.answeredMinds.length}/${q.totalMinds} Minds answered`
            : `${q.answeredMinds.length} Minds answered so far`
          const status = q.status === 'aggregating' ? 'aggregating results' : progress
          lines.push(`Active question: "${q.question.slice(0, 60)}${q.question.length > 60 ? '...' : ''}"`)
          lines.push(`  Status: ${status}`)
          if (q.answeredMinds.length > 0) {
            lines.push(`  Answered: ${q.answeredMinds.map(a => `${a.sparkName}: ${a.value.slice(0, 40)}`).join(', ')}`)
          }
          if (q.totalMinds > 0 && q.answeredMinds.length < q.totalMinds) {
            lines.push(`  Waiting for ${q.totalMinds - q.answeredMinds.length} more Mind(s)...`)
          }
        }
      }

      if (recentCompleted.length > 0) {
        // Update widget context with latest completed results
        const latestCompleted = recentCompleted[recentCompleted.length - 1]
        if (latestCompleted?.outputData && resolvedPanelId) {
          context.setLatestPanel(resolvedPanelId, latestCompleted.outputData)
        }

        lines.push('')
        lines.push('Recent results:')
        for (const q of recentCompleted) {
          lines.push(`  "${q.question.slice(0, 60)}${q.question.length > 60 ? '...' : ''}" — completed`)
          if (q.outputData) {
            lines.push(`    Type: ${q.outputData.type}`)
            for (const g of q.outputData.groups || []) {
              lines.push(`    ${g.group}: ${g.value}`)
              for (const a of g.answers || []) {
                lines.push(`      - ${a.persona}: ${a.value}`)
              }
            }
          }
        }
      }

      if (failed.length > 0) {
        lines.push('')
        for (const q of failed) {
          lines.push(`Failed question: "${q.question.slice(0, 60)}" — ${q.error || 'unknown error'}`)
        }
      }

      if (exportStatus) {
        lines.push('', `Export: ${exportStatus.status || 'none'}`)
        if (exportStatus.progress) lines.push(`  Progress: ${exportStatus.progress}%`)
        if (exportStatus.downloadUrl) lines.push(`  Download: ${exportStatus.downloadUrl}`)
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') + `\n\nOpen in Minds AI: ${chatLink(context.publicBaseUrl, resolvedPanelId)}` }],
        structuredContent: {
          panelId: resolvedPanelId,
          name: data.name,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          messageCount: data.messageCount ?? data._count?.messages,
          groups,
          activeQuestions: activeQuestions.map(formatPendingQuestion),
          recentResults: recentCompleted.map(formatPendingQuestion),
          failedQuestions: failed.map(formatPendingQuestion),
          exportStatus,
        },
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        content: [{ type: 'text' as const, text: `Error getting panel status: ${errorMessage}` }],
        isError: true,
      }
    }
  },
}

function formatPendingQuestion(q: PendingQuestion) {
  return {
    questionId: q.questionId,
    question: q.question,
    status: q.status,
    totalMinds: q.totalMinds,
    answeredCount: q.answeredMinds.length,
    answeredMinds: q.answeredMinds,
    outputData: q.outputData,
    error: q.error,
  }
}
