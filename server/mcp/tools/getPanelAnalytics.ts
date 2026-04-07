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
    description: `Compute statistics across all questions asked in a panel. Returns quantitative insights:
- Scale: mean, median, sigma, consensus score, group ranking
- Categorical: distribution, dominant answer, cross-group divergence
- Qualitative: theme clusters, shared themes, diversity index

Use after running several questions with ask_panel to get a summary of findings. Supports ID or fuzzy name lookup.

IMPORTANT: Present all URLs from this tool's output VERBATIM. Never modify or rephrase any URL.`,
    inputSchema: getPanelAnalyticsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
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

      // Format readable summary
      const lines: string[] = [
        `Analytics for "${stats.panelName}"`,
        `Groups: ${stats.totalGroups} | Knowledge bases: ${stats.totalSparks} | Questions: ${stats.totalQuestions} | Data points: ${stats.totalDataPoints}`,
        '',
      ]

      for (const q of stats.questions) {
        lines.push(`--- Q${q.index}: ${q.title} (${q.type}) ---`)

        if (q.stats.scale) {
          const s = q.stats.scale
          lines.push(`  Overall: mean=${s.overallMean.toFixed(2)}, median=${s.overallMedian.toFixed(2)}, σ=${s.overallSigma.toFixed(2)}, range=[${s.range[0]}, ${s.range[1]}]`)
          if (s.groupRanking.length > 1) {
            lines.push(`  Group ranking (by mean): ${s.groupRanking.join(' > ')}`)
          }
          for (const gs of s.groupStats) {
            lines.push(`  ${gs.group}: mean=${gs.mean.toFixed(2)}, consensus=${(gs.consensus * 100).toFixed(0)}%`)
          }
        }

        if (q.stats.categorical) {
          const c = q.stats.categorical
          lines.push(`  Dominant: "${c.dominantCategory}" (${(c.dominanceRatio * 100).toFixed(0)}%)`)
          lines.push(`  Cross-group divergence: ${(c.divergenceScore * 100).toFixed(0)}%`)
          for (const gs of c.groupStats) {
            lines.push(`  ${gs.group}: "${gs.dominant}" (${gs.unanimous ? 'unanimous' : `${(gs.dominanceRatio * 100).toFixed(0)}% agreement`})`)
          }
        }

        if (q.stats.qualitative) {
          const ql = q.stats.qualitative
          lines.push(`  Unique themes: ${ql.uniqueCategories}`)
          if (ql.sharedThemes.length > 0) {
            lines.push(`  Shared across groups: ${ql.sharedThemes.join(', ')}`)
          }
          for (const gs of ql.groupStats) {
            lines.push(`  ${gs.group}: dominant="${gs.dominant}", diversity=${(gs.diversityIndex * 100).toFixed(0)}%`)
          }
        }
        lines.push('')
      }

      if (stats.scaleQuestionRanking && stats.scaleQuestionRanking.length > 1) {
        lines.push('--- Scale Question Ranking ---')
        for (const sq of stats.scaleQuestionRanking) {
          lines.push(`  ${sq.title}: mean=${sq.mean.toFixed(2)} (σ=${sq.sigma.toFixed(2)})`)
        }
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') + `\n\nOpen panel: ${chatLink(context.publicBaseUrl, resolvedPanelId)}` }],
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
