/**
 * Type definitions for MCP server
 */

import { z } from 'zod'

// Tool input schemas
export const listSparksSchema = {
  searchQuery: z.string().optional().describe('Search for a persona by name (e.g., "marketing expert", "Einstein", "my advisor"). Fuzzy matching supported.'),
}

export const createSparkSchema = {
  name: z.string().min(1).describe('Name of the AI persona (e.g., "Marketing Expert", "Steve Jobs", "My Legal Advisor")'),
  mode: z.enum(['keywords', 'clone', 'link', 'manual']).describe('How to train: "clone" to emulate a person, "keywords" for topic expertise, "link" to learn from a website'),
  type: z.enum(['creative', 'expert', 'user']).default('expert').describe('Persona type: "creative" for artists/writers, "expert" for advisors/specialists, "user" for customer personas'),
  discipline: z.string().optional().describe('Area of expertise (e.g., "Marketing Strategy", "Solar Energy", "Legal Compliance")'),
  keywords: z.array(z.string()).optional().describe('Topics and expertise areas to train on (e.g., ["content marketing", "SEO", "brand strategy"])'),
  personaContext: z.string().optional().describe('The person to emulate - can be a name, description, or social profile (e.g., "Elon Musk", "my CEO", "linkedin.com/in/username")'),
  contextLink: z.string().url().optional().describe('Website or documentation URL to learn from (e.g., "https://company.com/docs")'),
  description: z.string().optional().describe('What this AI persona specializes in or what makes them unique'),
  demo: z.boolean().optional().default(true).describe('Enable demo mode for real-time training progress (recommended)'),
}

export const chatWithSparkSchema = {
  sparkId: z.string().uuid().optional().describe('Exact ID of the AI persona (use sparkName for easier lookup)'),
  sparkName: z.string().optional().describe('Name of the AI persona to talk to (e.g., "my marketing expert", "Einstein"). Fuzzy matching finds the best match.'),
  message: z.string().min(1).describe('Your message or question to the AI persona'),
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).optional().describe('Previous messages for context in multi-turn conversations'),
}

export const getSparkStatusSchema = {
  sparkId: z.string().uuid().describe('ID of the AI persona to check training status for'),
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
  demo?: boolean
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
