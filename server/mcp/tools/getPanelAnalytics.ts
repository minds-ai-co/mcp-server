/**
 * Get Panel Analytics Tool Handler
 * Computes statistics for panel questions using the panel-statistics engine
 */

import { getPanelAnalyticsSchema, type GetPanelAnalyticsArgs, type McpServerContext } from '../types'
import { createApiClient } from '../utils/apiClient'
import { findBestMatch } from '../utils/fuzzyMatch'
import { chatLink } from '../utils/links'
import { computePanelStatistics, type PanelStatistics } from '~/server/utils/panel-statistics'

export const getPanelAnalyticsTool = {
  name: 'get_panel_analytics',
  config: {
    title: 'Get Panel Analytics',
    description: `**Call this tool whenever the user wants a summary, statistics, analytics, insights, or "the big picture" across a panel's questions.** Triggers include: "summarize my panel", "what did the panel find", "give me the analytics for <panel>", "key insights from <panel>", "summary of the <study/survey> results".

Returns quantitative insights:
- Scale: mean, median, sigma, consensus score, group ranking
- Categorical: distribution, dominant answer, cross-group divergence
- Qualitative: theme clusters, shared themes, diversity index

Use after running several questions with ask_panel to get a summary of findings. Supports ID or fuzzy name lookup.

PRESENTATION CONTRACT — when no rich widget is rendered (OWUI, Langdock, Windsurf, plain ChatGPT), preserve the markdown structure verbatim: panel header with link, one section per question, **bold group name** with the aggregated value (mean for scale, dominant for categorical, theme list for qualitative). The format mirrors the PanelAnswerBlock widget so users get the same shape regardless of client.

IMPORTANT: Present all URLs from this tool's output VERBATIM. Never modify, shorten, or rephrase any URL. Always show the panel link — it is the user's path back into the Minds platform.`,
    inputSchema: getPanelAnalyticsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
      costHint: 'medium' as const,
      timeoutHint: 15000,
      confirmationHint: false,
    },
    _meta: {
      'openai/visibility': 'public',
      'openai/scopes': ['flows:read'],
    },
  },

  handler: async (args: GetPanelAnalyticsArgs, context: McpServerContext) => {
    const { apiCall } = createApiClient({ authToken: context.apiKey, apiBaseUrl: context.apiBaseUrl })

    try {
      // Resolve panel ID from name if needed
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

      // Fetch full panel detail (includes messages with outputData)
      const panel = await apiCall(`/api/v1/panels/${resolvedPanelId}`)
      const data = panel.data || panel

      // Extract groups info
      const groups = (data.groups || []).map((g: any) => ({
        name: g.name,
        sparkCount: g.sparks?.length || 0,
      }))

      // Extract questions from assistant messages that have outputData in metadata
      const questions: Array<{ title: string; type: string; outputData: any }> = []
      for (const msg of data.messages || []) {
        if (msg.role !== 'assistant') continue
        const metadata = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : msg.metadata
        if (!metadata?.outputData) continue
        const od = metadata.outputData
        questions.push({
          title: od.title || `Question ${questions.length + 1}`,
          type: od.type || 'qualitative',
          outputData: od,
        })
      }

      if (questions.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No question results found in this panel. Ask some questions first using ask_panel.' }],
          isError: false,
        }
      }

      // Compute statistics using the existing engine
      const stats: PanelStatistics = computePanelStatistics(data.name, groups, questions)

      // Render in PanelAnswerBlock-shape: per-question section, **bold group**
      // with aggregated value, panel link header — same layout as get_panel_status
      // so non-widget clients see consistent output across panel tools.
      const panelHref = chatLink(context.publicBaseUrl, resolvedPanelId)
      const lines: string[] = [
        `## [${stats.panelName}](${panelHref}) — analytics`,
        `Groups: ${stats.totalGroups} · Minds: ${stats.totalSparks} · Questions: ${stats.totalQuestions} · Data points: ${stats.totalDataPoints}`,
      ]

      for (const q of stats.questions) {
        lines.push('', `### ${q.title} _(${q.type})_`)

        if (q.stats.scale) {
          const s = q.stats.scale
          lines.push(`Overall: **mean ${s.overallMean.toFixed(2)}** · median ${s.overallMedian.toFixed(2)} · σ ${s.overallSigma.toFixed(2)} · range [${s.range[0]}, ${s.range[1]}]`)
          if (s.groupRanking.length > 1) {
            lines.push(`Group ranking (by mean): ${s.groupRanking.join(' > ')}`)
          }
          for (const gs of s.groupStats) {
            lines.push(`- **${gs.group}** — Ø ${gs.mean.toFixed(2)} (consensus ${(gs.consensus * 100).toFixed(0)}%)`)
          }
        }

        if (q.stats.categorical) {
          const c = q.stats.categorical
          lines.push(`Dominant: _${c.dominantCategory}_ (${(c.dominanceRatio * 100).toFixed(0)}%) · cross-group divergence ${(c.divergenceScore * 100).toFixed(0)}%`)
          for (const gs of c.groupStats) {
            lines.push(`- **${gs.group}** — _${gs.dominant}_ (${gs.unanimous ? 'unanimous' : `${(gs.dominanceRatio * 100).toFixed(0)}% agreement`})`)
          }
        }

        if (q.stats.qualitative) {
          const ql = q.stats.qualitative
          lines.push(`Unique themes: ${ql.uniqueCategories}${ql.sharedThemes.length > 0 ? ` · shared: ${ql.sharedThemes.join(', ')}` : ''}`)
          for (const gs of ql.groupStats) {
            lines.push(`- **${gs.group}** — _${gs.dominant}_ (diversity ${(((gs as any).diversityIndex ?? 0) * 100).toFixed(0)}%)`)
          }
        }
      }

      if (stats.scaleQuestionRanking && stats.scaleQuestionRanking.length > 1) {
        lines.push('', '### Scale question ranking')
        for (const sq of stats.scaleQuestionRanking) {
          lines.push(`- ${sq.title} — **mean ${sq.mean.toFixed(2)}** (σ ${sq.sigma.toFixed(2)})`)
        }
      }

      lines.push('', `[Open this panel in Minds →](${panelHref})`)

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        structuredContent: { panelId: resolvedPanelId, statistics: stats },
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        content: [{ type: 'text' as const, text: `Error computing analytics: ${errorMessage}` }],
        isError: true,
      }
    }
  },
}
