/**
 * Type definitions for MCP server
 */

import { z } from 'zod'

// Tool input schemas
export const listSparksSchema = {
  searchQuery: z.string().optional().describe('Search for a Mind by name (e.g., "marketing expert"). Fuzzy matching supported.'),
}

export const createSparkSchema = {
  name: z.string().min(1).describe('Name for the Mind (e.g., "Marketing Expert", "Gen Z Consumer", "Solar Energy Advisor")'),
  mode: z.enum(['keywords', 'clone', 'link', 'manual']).describe('Training mode: "keywords" for topic expertise, "clone" to model a public figure, "link" to learn from a URL'),
  type: z.enum(['creative', 'expert', 'user']).default('expert').describe('"expert" for domain specialists, "creative" for creative fields, "user" for simulating a target audience persona'),
  discipline: z.string().optional().describe('Area of expertise (e.g., "Marketing Strategy", "Solar Energy", "Legal Compliance")'),
  keywords: z.array(z.string()).optional().describe('Topics to train on (required for keywords mode). E.g., ["content marketing", "SEO", "brand strategy"]'),
  personaContext: z.string().optional().describe('For clone mode: the public figure to model (e.g., "Warren Buffett", "Seth Godin")'),
  contextLink: z.string().url().optional().describe('For link mode: URL to learn from (e.g., "https://company.com/docs")'),
  description: z.string().optional().describe('What this Mind specializes in'),
}

export const chatWithSparkSchema = {
  mindId: z.string().uuid().optional().describe('Mind ID (UUID). Preferred. Use mindName for fuzzy lookup.'),
  mindName: z.string().optional().describe('Mind name — fuzzy matched (e.g., "my marketing expert")'),
  message: z.string().min(1).describe('Your question or message for the Mind'),
}

export const getSparkStatusSchema = {
  mindId: z.string().uuid().optional().describe('ID of the Mind to check training status for. Preferred.'),
  sparkId: z.string().uuid().optional().describe('Legacy alias for mindId.'),
}

export const createPanelSchema = {
  name: z.string().min(1).describe('Name for the panel (e.g., "Brand Perception Study", "Q4 Market Research")'),
  groupConfigs: z.array(z.object({
    name: z.string().optional().describe('Group name (optional — defaults to "Group N"). E.g., "Gen Z Consumers", "Marketing Experts"'),
    mindIds: z.array(z.string()).optional().describe('Mind IDs to add to this group — use list_minds to find IDs'),
    sparkIds: z.array(z.string()).optional().describe('Legacy alias for mindIds. Accepted for back-compat.'),
  })).optional().describe('New groups to create inline. Each group needs mindIds (legacy: sparkIds); name is optional and defaults to "Group N".'),
  groupIds: z.array(z.string()).optional().describe('Existing group IDs to attach — use list_groups to find IDs'),
}

export const askPanelSchema = {
  panelId: z.string().optional().describe('Panel ID (UUID)'),
  panelName: z.string().optional().describe('Panel name (fuzzy matched)'),
  question: z.string().min(1).describe('Research question to survey across all groups'),
  groupIds: z.array(z.string()).optional().describe('Only survey specific groups (defaults to all)'),
  attachments: z
    .array(
      z.object({
        url: z.string().optional().describe('Public or signed URL of an uploaded/remote file'),
        path: z.string().optional().describe('Storage path of an already-uploaded file'),
        name: z.string().optional().describe('File name'),
        type: z.string().optional().describe('MIME type when known'),
      }),
    )
    .optional()
    .describe('Files/images (e.g. a pitch deck PDF) processed once and given to every panelist as context. Each entry needs a url or path.'),
}

export const exportPanelSchema = {
  panelId: z.string().optional().describe('Panel ID (UUID)'),
  panelName: z.string().optional().describe('Panel name (fuzzy matched)'),
  format: z.enum(['pdf', 'json', 'csv', 'xls', 'md', 'markdown']).optional().describe('Export format: "pdf" (default) branded report, "csv" spreadsheet, "xls" Excel, "json" raw data, "md" (or "markdown") markdown report'),
}

export const listPanelsSchema = {
  searchQuery: z.string().optional().describe('Search for a panel by name (fuzzy matching supported)'),
}

export const getPanelStatusSchema = {
  panelId: z.string().uuid().optional().describe('Panel ID (UUID)'),
  panelName: z.string().optional().describe('Panel name (fuzzy matched)'),
}

export const listGroupsSchema = {
  searchQuery: z.string().optional().describe('Search for a group by name (fuzzy matching supported)'),
}

export const getPanelAnalyticsSchema = {
  panelId: z.string().uuid().optional().describe('Panel ID (UUID)'),
  panelName: z.string().optional().describe('Panel name (fuzzy matched)'),
}

// Type definitions derived from schemas
export type CreateSparkArgs = {
  name: string
  mode: 'keywords' | 'clone' | 'link' | 'manual'
  type?: 'creative' | 'expert' | 'user'
  discipline?: string
  keywords?: string[]
  personaContext?: string
  contextLink?: string
  description?: string
}

export type ChatWithSparkArgs = {
  mindId?: string
  mindName?: string
  sparkId?: string   // legacy, tolerated but not advertised
  sparkName?: string // legacy, tolerated but not advertised
  message: string
}

export type ListSparksArgs = {
  searchQuery?: string
}

export type GetSparkStatusArgs = {
  mindId?: string
  sparkId?: string
}

export type ListPanelsArgs = {
  searchQuery?: string
}

export type GetPanelStatusArgs = {
  panelId?: string
  panelName?: string
}

export type ListGroupsArgs = {
  searchQuery?: string
}

export type GetPanelAnalyticsArgs = {
  panelId?: string
  panelName?: string
}

// Spark data types
export interface SparkData {
  id: string
  name: string
  description?: string
  type?: string
  discipline?: string
  profileImageUrl?: string
  systemPrompt?: string
}

/** Options for creating the MCP server */
export interface CreateMindsServerOptions {
  /** Public-facing base URL (default: 'https://getminds.ai') */
  publicBaseUrl?: string
  /** Bearer token for authentication */
  authToken?: string
  /** API base URL override for external calls (stdio transport) */
  apiBaseUrl?: string
  /** Use ext-apps registration for tools/resources (HTTP transport) */
  useExtApps?: boolean
  /**
   * Alias-to-canonical map registered alongside canonical tools.
   * Defaults to the module-level TOOL_ALIASES. Override in tests to
   * exercise the construction-time guards without mutating shared state.
   */
  toolAliases?: Record<string, string>
}

// Server context passed to tool handlers
export interface McpServerContext {
  publicBaseUrl: string
  apiKey: string
  authenticatedUserId: string | null
  userDiscoveryToken: string | null
  latestSparkId: string | null
  latestSparkCreatedAt: number
  setLatestSpark: (sparkId: string) => void
  latestPanelId: string | null
  latestOutputData: any
  setLatestPanel: (panelId: string, outputData?: any) => void
  /** Optional API base URL override for stdio transport */
  apiBaseUrl?: string
}
