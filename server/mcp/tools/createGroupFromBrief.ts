/**
 * Create Group From Brief Tool Handler
 *
 * Grounded group creation from a free-text brief — wraps
 * POST /api/v1/groups/from-brief. Unlike `create_group` (which only wraps
 * existing Mind IDs), this tool runs the deep-research grounding pipeline
 * (Tavily → structured demographic distributions → persisted) and invents
 * the personas itself, giving external agents the same group-creation
 * quality as the in-app "New Group" sidebar flow.
 */

import { z } from 'zod'
import { type McpServerContext } from '../types'
import { createApiClient } from '../utils/apiClient'
import { mindLink, workspaceLink } from '../utils/links'

const createGroupFromBriefSchema = z
  .object({
    brief: z
      .string()
      .min(3)
      .max(4000)
      .optional()
      .describe(
        'Free-text brief describing the population the group should represent. ' +
          'E.g. "California high school students grades 9-12", "Berlin Späti customers", ' +
          '"Spanish lawyers", "management team of Coca Cola". The server runs deep web ' +
          'research on this brief to find demographic / psychographic distributions from ' +
          'authoritative sources, then generates personas that proportionally reflect those ' +
          'distributions.',
      ),
    text: z
      .string()
      .min(3)
      .max(4000)
      .optional()
      .describe('Legacy alias for `brief`. Accepted for back-compat.'),
    name: z
      .string()
      .max(100)
      .optional()
      .describe('Optional group name override. When omitted, the server names the group from the brief or the LLM detection result.'),
    links: z
      .array(z.string())
      .max(10)
      .optional()
      .describe('Optional URLs scraped server-side for additional context (e.g. an article describing the population).'),
    keywords: z
      .array(z.string())
      .max(10)
      .optional()
      .describe('Optional Tavily search seeds added alongside the brief.'),
  })
  .refine((v) => Boolean(v.brief || v.text), {
    message: 'Provide a brief (free-text description of the group).',
    path: ['brief'],
  })

type CreateGroupFromBriefArgs = z.infer<typeof createGroupFromBriefSchema>

export const createGroupFromBriefTool = {
  name: 'create_group_from_brief',
  config: {
    title: 'Create a Grounded Group from a Brief',
    description: `**Call this tool when the user describes a POPULATION or AUDIENCE rather than naming specific Minds.** Triggers include: "build me a panel of <demographic>", "create a group representing <segment>", "make personas for <audience>".

Behavior:
- Server runs deep web research on the brief and extracts demographic / psychographic distributions from authoritative sources (government statistics, peer-reviewed studies, industry reports — NOT blogs or marketing content).
- Personas are generated to proportionally reflect those distributions (age, gender, region, income, etc.) — not as generic "Sarah / David / Marcus" roles.
- The grounding (distributions, sources, summary, confidence) is persisted on the group and visible in the in-app group info slide-in and on public share links.
- Pass the population description as \`brief\` (legacy \`text\` is also accepted).

Use \`create_group\` instead when the user gives you specific Mind IDs to bag into a named group. Use this tool when the user describes a POPULATION and wants the server to invent the personas.

PRESENTATION CONTRACT — preserve the workspace link in the response verbatim. Never strip or modify URLs from this tool's output.`,
    inputSchema: createGroupFromBriefSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
      // 60s grounding ceiling + ~5-15s detection + per-Mind row creation.
      // Most calls finish in 15-30s; size the hint for the long tail.
      costHint: 'medium' as const,
      timeoutHint: 90000,
      confirmationHint: false,
    },
    _meta: {
      'openai/visibility': 'public',
      'openai/scopes': ['sparks:write'],
    },
  },

  handler: async (args: CreateGroupFromBriefArgs, context: McpServerContext) => {
    const { name, links, keywords } = args
    const brief = args.brief ?? args.text
    const { apiCall } = createApiClient({ authToken: context.apiKey, apiBaseUrl: context.apiBaseUrl })

    try {
      const result = await apiCall('/api/v1/groups/from-brief', {
        method: 'POST',
        body: JSON.stringify({ text: brief, name, links, keywords }),
        // Override the 30s default — grounded creation runs deep web
        // research (60s ceiling) plus persona generation. Mirrors the
        // tool's own timeoutHint of 90s.
        timeout: 90_000,
      })

      const group = result.data || result
      const memberCount = group.sparkCount ?? group.sparks?.length ?? 0
      const memberLinks = (group.sparks || [])
        .map((s: any) => (s.id ? `[${s.name}](${mindLink(context.publicBaseUrl, s.id)})` : s.name))
        .join(', ')

      const confidencePct = group.grounding
        ? Math.round((group.grounding.confidence ?? 0) * 100)
        : null
      const groundingLine = group.grounding?.summary
        ? `\n\n**Research summary** (confidence: ${confidencePct}%):\n${group.grounding.summary}`
        : group.grounding === null
          ? '\n\n_No authoritative demographic data found for this brief — personas were generated without distribution grounding._'
          : ''

      return {
        content: [
          {
            type: 'text' as const,
            text:
              `✓ Created grounded group **${group.name}** with ${memberCount} Mind${memberCount === 1 ? '' : 's'}` +
              `${memberLinks ? `: ${memberLinks}` : ''}` +
              groundingLine +
              `\n\n[Manage in the Minds workspace →](${workspaceLink(context.publicBaseUrl)})`,
          },
        ],
        structuredContent: {
          group: {
            id: group.id,
            name: group.name,
            sparkCount: memberCount,
            sparks: group.sparks || [],
            grounding: group.grounding ?? null,
          },
        },
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        content: [{ type: 'text' as const, text: `Error creating grounded group: ${errorMessage}` }],
        isError: true,
      }
    }
  },
}
