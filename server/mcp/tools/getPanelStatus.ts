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
import { chatLink, mindLink } from '../utils/links'
import { API_BASE_URL } from '../config'

export const getPanelStatusTool = {
  name: 'get_panel_status',
  config: {
    title: 'Get Panel Status',
    description: `Check the status of a panel — including live progress on in-flight questions.

Returns:
- Panel info (groups, Minds) with clickable links to each Mind and to the panel
- Active questions: which Minds have answered so far, how many remain
- Completed question results (aggregated, structured per-group)
- PDF export status (if any)

Call this after ask_panel to track progress, or after export_panel with format "pdf" to check if the download is ready.

PRESENTATION CONTRACT — when no rich widget is rendered (e.g. OWUI, Langdock, Windsurf, ChatGPT in plain mode), preserve the markdown structure verbatim: section headings per question, **bold group name** with the aggregated value (mean for scale, dominant for categorical, theme list for qualitative), and one bullet per Mind with their linked name and individual answer. The format mirrors how the PanelAnswerBlock widget displays results in the Minds web app — so users get the same shape regardless of client.

IMPORTANT: Present all URLs from this tool's output VERBATIM. Never modify, shorten, or rephrase any URL. Always show every Mind link and the panel link — they are the user's path back into the Minds platform.`,
    inputSchema: getPanelStatusSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
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

      // Build text summary as a PanelAnswerBlock-shaped markdown document.
      // Non-widget clients (OWUI, Langdock, plain ChatGPT) render this verbatim,
      // so every Mind name links to its detail page and the panel header links
      // back to the workspace — same shape the widget would show.
      const panelHref = chatLink(context.publicBaseUrl, resolvedPanelId)
      const sparkLink = (id: string, name: string) => `[${name}](${mindLink(context.publicBaseUrl, id)})`
      const linkSparkByName = (name: string): string => {
        for (const g of groups) {
          for (const s of g.sparks) if (s.name === name && s.id) return sparkLink(s.id, s.name)
        }
        return name
      }

      const lines: string[] = [
        `## [${data.name}](${panelHref})`,
        `Created: ${data.createdAt} · Messages: ${data.messageCount ?? data._count?.messages ?? 'unknown'}`,
        '',
        `**Groups (${groups.length}):**`,
      ]
      for (const g of groups) {
        const memberLinks = g.sparks.map((s: any) => s.id ? sparkLink(s.id, s.name) : s.name).join(', ')
        lines.push(`- **${g.name}** (${g.sparkCount} Mind${g.sparkCount === 1 ? '' : 's'}) — ${memberLinks || '_no Minds_'}`)
      }

      // Show pending/active questions
      const activeQuestions = pendingQuestions.filter(q => q.status === 'processing' || q.status === 'aggregating')
      const recentCompleted = pendingQuestions.filter(q => q.status === 'completed')
      const failed = pendingQuestions.filter(q => q.status === 'failed')

      // Render per-group answers as a markdown TABLE (renders in OWUI, Langdock,
      // plain ChatGPT, and inside the rich widget). For scale questions, append a
      // unicode bar chart of group means so the user sees relative magnitudes
      // even without the HTML widget.
      const BAR_GLYPH = '█'
      const renderScaleBar = (value: number, max: number, width: number = 20): string => {
        if (!Number.isFinite(value) || max <= 0) return ''
        const fill = Math.max(0, Math.min(width, Math.round((value / max) * width)))
        return BAR_GLYPH.repeat(fill) + '·'.repeat(width - fill)
      }
      const renderAnswerTable = (rows: Array<{ name: string; value: string }>): string => {
        if (rows.length === 0) return '_No answers yet._'
        const header = '| Mind | Answer |\n|------|--------|'
        const body = rows.map(r => `| ${r.name} | ${r.value} |`).join('\n')
        return `${header}\n${body}`
      }

      if (activeQuestions.length > 0) {
        for (const q of activeQuestions) {
          lines.push('', `### In progress: "${q.question}"`)
          const progress = q.totalMinds > 0
            ? `${q.answeredMinds.length}/${q.totalMinds} Minds answered`
            : `${q.answeredMinds.length} Minds answered so far`
          lines.push(q.status === 'aggregating' ? '_aggregating results…_' : `_${progress}_`)
          if (q.answeredMinds.length > 0) {
            lines.push('')
            lines.push(renderAnswerTable(q.answeredMinds.map(a => ({ name: linkSparkByName(a.sparkName), value: a.value }))))
          }
          if (q.totalMinds > 0 && q.answeredMinds.length < q.totalMinds) {
            lines.push('', `_Waiting for ${q.totalMinds - q.answeredMinds.length} more Mind${q.totalMinds - q.answeredMinds.length === 1 ? '' : 's'}…_`)
          }
        }
      }

      if (recentCompleted.length > 0) {
        const latestCompleted = recentCompleted[recentCompleted.length - 1]
        if (latestCompleted?.outputData && resolvedPanelId) {
          context.setLatestPanel(resolvedPanelId, latestCompleted.outputData)
        }

        for (const q of recentCompleted) {
          lines.push('', `### ${q.question}`)
          if (!q.outputData) continue
          const type = q.outputData.type
          const groupsArr = q.outputData.groups || []

          // Scale questions: ASCII bar chart comparing group means at the top
          // of the question section, then per-Mind tables below.
          if (type === 'scale' && groupsArr.length > 0) {
            const numericValues = groupsArr.map((g: any) => parseFloat(g.value)).filter((n: number) => Number.isFinite(n))
            if (numericValues.length > 0) {
              const maxVal = Math.max(...numericValues, 10)
              lines.push('')
              lines.push('| Group | Mean | Distribution |')
              lines.push('|-------|------|--------------|')
              for (const g of groupsArr) {
                const v = parseFloat(g.value)
                const bar = Number.isFinite(v) ? renderScaleBar(v, maxVal) : '—'
                lines.push(`| **${g.group}** | ${Number.isFinite(v) ? v.toFixed(1) : g.value} | \`${bar}\` |`)
              }
            }
          }

          for (const g of groupsArr) {
            // Aggregated value per group: mean for scale, dominant for categorical, theme list for qualitative.
            const groupHeader = type === 'scale'
              ? `**${g.group}** — Ø ${g.value}`
              : type === 'categorical'
                ? `**${g.group}** — _${g.value}_`
                : `**${g.group}** — ${g.value}`
            lines.push('', groupHeader)
            const rows = (g.answers || []).map((a: any) => ({ name: linkSparkByName(a.persona), value: a.value }))
            lines.push(renderAnswerTable(rows))
          }
        }
      }

      if (failed.length > 0) {
        for (const q of failed) {
          lines.push('', `### ⚠️ Failed: "${q.question}"`)
          lines.push(q.error || '_unknown error_')
        }
      }

      // The server normally emits a pre-signed Supabase URL here; if signing
      // failed and it fell back to the proxy path, make it absolute so the
      // LLM client receives a clickable link.
      const absoluteDownloadUrl = exportStatus?.downloadUrl
        ? (exportStatus.downloadUrl.startsWith('http')
          ? exportStatus.downloadUrl
          : `${context.publicBaseUrl}${exportStatus.downloadUrl}`)
        : undefined

      if (exportStatus) {
        lines.push('', `**Export:** ${exportStatus.status || 'none'}`)
        if (exportStatus.progress) lines.push(`Progress: ${exportStatus.progress}%`)
        if (absoluteDownloadUrl) lines.push(`[Download](${absoluteDownloadUrl})`)
      }

      lines.push('', `[Open this panel in Minds →](${panelHref})`)

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
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
          exportStatus: exportStatus ? { ...exportStatus, downloadUrl: absoluteDownloadUrl } : undefined,
          apiBase: context.publicBaseUrl || API_BASE_URL,
          authToken: context.apiKey,
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
