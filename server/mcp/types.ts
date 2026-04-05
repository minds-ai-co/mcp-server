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
  sparkId: z.string().uuid().optional().describe('Mind ID (UUID). Use sparkName for easier lookup.'),
  sparkName: z.string().optional().describe('Mind name — fuzzy matched (e.g., "my marketing expert")'),
  message: z.string().min(1).describe('Your question or message for the Mind'),
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).optional().describe('Previous messages for multi-turn context'),
}

export const getSparkStatusSchema = {
  sparkId: z.string().uuid().describe('ID of the Mind to check training status for'),
}

export const createPanelSchema = {
  name: z.string().min(1).describe('Name for the panel (e.g., "Brand Perception Study", "Q4 Market Research")'),
  groupConfigs: z.array(z.object({
    name: z.string().describe('Group name (e.g., "Gen Z Consumers", "Marketing Experts")'),
    sparkIds: z.array(z.string()).describe('Mind IDs to add to this group — use list_minds to find IDs'),
  })).optional().describe('New groups to create inline with their Mind IDs'),
  groupIds: z.array(z.string()).optional().describe('Existing group IDs to attach — use list_groups to find IDs'),
}

export const askPanelSchema = {
  panelId: z.string().optional().describe('Panel ID (UUID)'),
  panelName: z.string().optional().describe('Panel name (fuzzy matched)'),
  question: z.string().min(1).describe('Research question to survey across all groups'),
  groupIds: z.array(z.string()).optional().describe('Only survey specific groups (defaults to all)'),
}

export const exportPanelSchema = {
  panelId: z.string().optional().describe('Panel ID (UUID)'),
  panelName: z.string().optional().describe('Panel name (fuzzy matched)'),
  format: z.enum(['md', 'pdf', 'json']).optional().describe('Export format: "md" (default) for inline markdown, "pdf" for branded PDF (async), "json" for structured data'),
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
  sparkId?: string
  sparkName?: string
  message: string
  conversationHistory?: Array<{
    role: 'user' | 'assistant'
    content: string
  }>
}

export type ListSparksArgs = {
  searchQuery?: string
}

export type GetSparkStatusArgs = {
  sparkId: string
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
  /** Optional API base URL override for stdio transport */
  apiBaseUrl?: string
}
