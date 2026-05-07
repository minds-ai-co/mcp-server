// @ts-ignore - vitest types not available during nuxt typecheck
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock the internal API client ────────────────────────────────────────
const mockApiCall = vi.fn()
vi.mock('../../utils/apiClient', () => ({
  createApiClient: vi.fn(() => ({ apiCall: mockApiCall })),
}))

// Real mindLink / workspaceLink — they're tiny pure helpers, no need to stub.
import { createGroupFromBriefTool } from '../createGroupFromBrief'

const context = {
  apiKey: 'minds_test_key',
  apiBaseUrl: 'https://api.example.com',
  publicBaseUrl: 'https://app.example.com',
} as any

describe('MCP create_group_from_brief tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('schema', () => {
    const schema = createGroupFromBriefTool.config.inputSchema

    it('rejects empty text', () => {
      expect(() => schema.parse({ text: '' })).toThrow()
    })

    it('rejects text below the 3-char minimum', () => {
      expect(() => schema.parse({ text: 'ab' })).toThrow()
    })

    it('rejects text above the 4000-char ceiling', () => {
      expect(() => schema.parse({ text: 'x'.repeat(4001) })).toThrow()
    })

    it('accepts a minimal valid payload', () => {
      const parsed = schema.parse({ text: 'Berlin renters' })
      expect(parsed.text).toBe('Berlin renters')
    })

    it('accepts the full payload shape', () => {
      const parsed = schema.parse({
        text: 'Spanish lawyers',
        name: 'Custom Group',
        links: ['https://example.com'],
        keywords: ['barrister', 'abogado'],
      })
      expect(parsed).toMatchObject({
        text: 'Spanish lawyers',
        name: 'Custom Group',
        links: ['https://example.com'],
        keywords: ['barrister', 'abogado'],
      })
    })
  })

  describe('handler — success cases', () => {
    it('forwards the validated body to /api/v1/groups/from-brief with a 90s timeout', async () => {
      mockApiCall.mockResolvedValue({
        data: {
          id: 'group-1',
          name: 'Berlin Renters',
          sparkCount: 2,
          sparks: [
            { id: 'spark-1', name: 'Anna' },
            { id: 'spark-2', name: 'Bruno' },
          ],
          grounding: null,
        },
      })

      await createGroupFromBriefTool.handler(
        { text: 'Berlin renters', name: 'Custom Name', links: ['https://x.com'], keywords: ['rent'] },
        context,
      )

      expect(mockApiCall).toHaveBeenCalledTimes(1)
      const [endpoint, opts] = mockApiCall.mock.calls[0]
      expect(endpoint).toBe('/api/v1/groups/from-brief')
      expect(opts.method).toBe('POST')
      expect(opts.timeout).toBe(90_000)
      expect(JSON.parse(opts.body)).toEqual({
        text: 'Berlin renters',
        name: 'Custom Name',
        links: ['https://x.com'],
        keywords: ['rent'],
      })
    })

    it('renders a text response with mind links and a workspace link', async () => {
      mockApiCall.mockResolvedValue({
        data: {
          id: 'group-1',
          name: 'Berlin Renters',
          sparkCount: 2,
          sparks: [
            { id: 'spark-1', name: 'Anna' },
            { id: 'spark-2', name: 'Bruno' },
          ],
          grounding: null,
        },
      })

      const result = await createGroupFromBriefTool.handler(
        { text: 'Berlin renters' },
        context,
      )

      expect(result.isError).toBeFalsy()
      const text = result.content[0].text
      expect(text).toContain('Berlin Renters')
      expect(text).toContain('Anna')
      expect(text).toContain('Bruno')
      expect(text).toContain('sparkId=spark-1')
      expect(text).toContain(context.publicBaseUrl)
    })

    it('renders the grounding summary + confidence percentage when present', async () => {
      mockApiCall.mockResolvedValue({
        data: {
          id: 'group-1',
          name: 'Berlin Renters',
          sparkCount: 1,
          sparks: [{ id: 'spark-1', name: 'Anna' }],
          grounding: {
            distributions: [],
            sources: [],
            summary: 'Renters in Berlin skew 25-34, predominantly Hispanic/Latino.',
            confidence: 0.82,
            suggestedMinGroupSize: 5,
          },
        },
      })

      const result = await createGroupFromBriefTool.handler(
        { text: 'Berlin renters' },
        context,
      )

      const text = result.content[0].text
      expect(text).toContain('Renters in Berlin skew 25-34')
      // 0.82 → 82%
      expect(text).toContain('82%')
    })

    it('renders the no-grounding-found note when the server returned grounding=null', async () => {
      mockApiCall.mockResolvedValue({
        data: {
          id: 'group-1',
          name: 'The Beatles',
          sparkCount: 4,
          sparks: [
            { id: 'spark-1', name: 'John' },
            { id: 'spark-2', name: 'Paul' },
            { id: 'spark-3', name: 'George' },
            { id: 'spark-4', name: 'Ringo' },
          ],
          grounding: null,
        },
      })

      const result = await createGroupFromBriefTool.handler(
        { text: 'The Beatles' },
        context,
      )

      const text = result.content[0].text
      expect(text).toContain('No authoritative demographic data found')
    })

    it('emits structuredContent with id, name, sparkCount, sparks and grounding', async () => {
      mockApiCall.mockResolvedValue({
        data: {
          id: 'group-1',
          name: 'Berlin Renters',
          sparkCount: 1,
          sparks: [{ id: 'spark-1', name: 'Anna' }],
          grounding: { distributions: [], sources: [], summary: 's', confidence: 0.5, suggestedMinGroupSize: 3 },
        },
      })

      const result = await createGroupFromBriefTool.handler(
        { text: 'Berlin renters' },
        context,
      )

      expect(result.structuredContent).toMatchObject({
        group: {
          id: 'group-1',
          name: 'Berlin Renters',
          sparkCount: 1,
          grounding: expect.objectContaining({ summary: 's', confidence: 0.5 }),
        },
      })
    })
  })

  describe('handler — error cases', () => {
    it('returns isError=true and the error message when the API call rejects', async () => {
      mockApiCall.mockRejectedValue(new Error('Plan limit exceeded'))

      const result = await createGroupFromBriefTool.handler(
        { text: 'Berlin renters' },
        context,
      )

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Plan limit exceeded')
    })

    it('handles non-Error throws gracefully', async () => {
      mockApiCall.mockRejectedValue('string error')

      const result = await createGroupFromBriefTool.handler(
        { text: 'Berlin renters' },
        context,
      )

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('string error')
    })
  })

  describe('tool metadata', () => {
    it('declares write scope and medium cost', () => {
      const meta = createGroupFromBriefTool.config._meta as any
      expect(meta['openai/scopes']).toContain('sparks:write')
      expect(createGroupFromBriefTool.config.annotations.costHint).toBe('medium')
    })

    it('declares a 90s timeoutHint matching the apiCall override', () => {
      expect(createGroupFromBriefTool.config.annotations.timeoutHint).toBe(90_000)
    })

    it('exposes a tool name distinct from create_group', () => {
      expect(createGroupFromBriefTool.name).toBe('create_group_from_brief')
    })
  })
})
