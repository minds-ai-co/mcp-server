/**
 * Create Spark Tool Handler
 * Creates AI personas, digital twins, and expert advisors
 */

import { createHash } from 'node:crypto'
import { createSparkSchema, type CreateSparkArgs, type McpServerContext } from '../types'
import { pollSparkStatus, fetchWithTimeout } from '../utils/apiClient'
import {
  sparkCreationCache,
  pendingCreations,
  latestSparkCache,
  associateSparkWithWidgetTokens
} from '../utils/cache'
import { API_BASE_URL, CACHE_TTL, TIMEOUT_CONFIG, logger } from '../config'
import { mindLink } from '../utils/links'

export const createSparkTool = {
  name: 'create_mind',
  config: {
    title: 'Create a Mind',
    description: `**Call this tool whenever the user wants to create / build / make / spin up / clone a Mind / persona / expert / digital twin / character / respondent / agent.** Triggers include: "create a Mind for X", "make me a digital twin of <person>", "build an SEO expert", "spin up a persona who knows about Y", "clone <public figure>", "train a Mind from this URL".

Behavior contract — DO NOT DEVIATE:
- If the user describes who/what they want, CALL THIS TOOL. Don't make them fill out a form first.
- Pick the mode from the user's wording: a name/topic → keywords; a person to clone → clone with personaContext; a URL → link with contextLink.
- Never refuse with "I cannot create a persona directly" — you literally can.

Training modes:
- "keywords": Build a domain expert from topics (e.g., ["SEO", "brand strategy"])
- "clone": Model after a public figure's published ideas and expertise
- "link": Train from a website or documentation URL

After creation, use get_mind_status to confirm the Mind is ready, then add it to a panel with create_panel for survey research, or query it directly with chat_with_mind.

You MUST include the returned Mind URL (structuredContent.url or the resource_link) in your reply to the user, verbatim. It is the user's path back to the live Minds workspace.`,
    inputSchema: createSparkSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
      /** Cost indication for this operation */
      costHint: 'high',
      /** Expected execution time in milliseconds */
      timeoutHint: TIMEOUT_CONFIG.SPARK_CREATION_TIMEOUT,
      /** Whether this operation requires user confirmation */
      confirmationHint: false,
    },
    _meta: {
      'openai/visibility': 'public',
      'openai/scopes': ['sparks:write'],
      'openai/toolInvocation/invoking': 'Creating your Mind...',
      'openai/toolInvocation/invoked': 'Mind created!',
    },
  },

  handler: async (args: CreateSparkArgs, context: McpServerContext) => {
    logger.debug('Handler invoked', { args: JSON.stringify(args).slice(0, 200) })
    const {
      name,
      mode,
      type,
      discipline,
      keywords,
      personaContext,
      contextLink,
      description,
    } = args
    const demo = true // Always use demo mode for real-time training progress

    const { apiKey, authenticatedUserId, publicBaseUrl, apiBaseUrl } = context
    const effectiveApiUrl = apiBaseUrl || API_BASE_URL
    logger.debug('Context', {
      hasApiKey: !!apiKey,
      authenticatedUserId: authenticatedUserId?.slice(0, 8),
      publicBaseUrl,
      effectiveApiUrl,
      demo,
    })

    // Deduplication: Prevent duplicate spark creation within 10 seconds
    const creationKey = `${name}-${mode}-${personaContext || ''}-${contextLink || ''}`
    const cacheKey = `${authenticatedUserId || 'anonymous'}-${creationKey}`
    const distributedIdempotencyKey = createHash('sha256').update(cacheKey).digest('hex')
    const now = Date.now()

    // Check if there's already a pending creation for this exact request
    const pendingPromise = pendingCreations.get(cacheKey)
    if (pendingPromise) {
      logger.debug('Found pending creation, waiting for it to complete', { cacheKey: cacheKey.slice(0, 60) })
      try {
        const sparkId = await pendingPromise
        logger.debug('Pending creation completed', { sparkId: sparkId.slice(0, 8) + '...' })
        const pollResult = await pollSparkStatus(sparkId, 1, false, effectiveApiUrl, apiKey)
        const sparkUrl = mindLink(publicBaseUrl, sparkId)
        const sparkName = pollResult.spark?.name || name
        return {
          content: [
            { type: 'text' as const, text: `✓ Mind **[${sparkName}](${sparkUrl})** already being created.\n\n[Open this Mind in the workspace →](${sparkUrl})` },
            { type: 'resource_link' as const, uri: sparkUrl, name: `Open ${sparkName}`, description: 'Open this Mind in the Minds workspace', mimeType: 'text/html', annotations: { audience: ['user'], priority: 1.0 } },
          ],
          structuredContent: {
            spark: {
              id: sparkId,
              name: sparkName,
              description: pollResult.spark?.description || description,
              type: pollResult.spark?.type || type,
              discipline: pollResult.spark?.discipline || discipline,
              profileImageUrl: pollResult.spark?.profileImageUrl || '',
              systemPrompt: pollResult.systemPrompt || '',
              url: sparkUrl,
            },
            url: sparkUrl,
            apiBaseUrl: publicBaseUrl,
            isProcessing: pollResult.status !== 'completed' && pollResult.status !== 'idle',
            progress: pollResult.progress || 5,
            status: pollResult.status || 'running',
            message: pollResult.message || 'Exploring the web...',
            knowledge: pollResult.knowledge || [],
          },
        }
      } catch (err) {
        logger.warn('Pending creation failed, will retry', { error: err instanceof Error ? err.message : String(err) })
      }
    }

    // Check completed cache
    const cached = sparkCreationCache.get(cacheKey)
    logger.debug('Spark creation request', {
      userId: authenticatedUserId?.slice(0, 8),
      cacheKey: cacheKey.slice(0, 60),
      cached: !!cached,
      pending: !!pendingPromise,
      timeSince: cached ? now - cached.timestamp : 'n/a'
    })

    if (cached && now - cached.timestamp < CACHE_TTL.SPARK_CREATION) {
      logger.debug('Duplicate spark creation detected, returning existing spark', { sparkId: cached.sparkId.slice(0, 8) + '...' })
      const pollResult = await pollSparkStatus(cached.sparkId, 1, false, effectiveApiUrl, apiKey)
      const sparkUrl = mindLink(publicBaseUrl, cached.sparkId)
      const sparkName = pollResult.spark?.name || name
      return {
        content: [
          { type: 'text' as const, text: `✓ Mind **[${sparkName}](${sparkUrl})** already being created.\n\n[Open this Mind in the workspace →](${sparkUrl})` },
          { type: 'resource_link' as const, uri: sparkUrl, name: `Open ${sparkName}`, description: 'Open this Mind in the Minds workspace', mimeType: 'text/html', annotations: { audience: ['user'], priority: 1.0 } },
        ],
        structuredContent: {
          spark: {
            id: cached.sparkId,
            name: sparkName,
            description: pollResult.spark?.description || description,
            type: pollResult.spark?.type || type,
            discipline: pollResult.spark?.discipline || discipline,
            profileImageUrl: pollResult.spark?.profileImageUrl || '',
            systemPrompt: pollResult.systemPrompt || '',
            url: sparkUrl,
          },
          url: sparkUrl,
          apiBaseUrl: publicBaseUrl,
          isProcessing: pollResult.status !== 'completed' && pollResult.status !== 'idle',
          progress: pollResult.progress || 5,
          status: pollResult.status || 'running',
          message: pollResult.message || 'Exploring the web...',
          knowledge: pollResult.knowledge || [],
        },
      }
    }

    // Create a deferred promise for parallel request handling
    let resolveCreation!: (sparkId: string) => void
    let rejectCreation!: (err: Error) => void
    const creationPromise = new Promise<string>((resolve, reject) => {
      resolveCreation = resolve
      rejectCreation = reject
    })
    // Prevent unhandled rejection when promise is rejected with no parallel waiters
    creationPromise.catch(() => {})
    pendingCreations.set(cacheKey, creationPromise)
    logger.debug('Registered pending creation', { cacheKey: cacheKey.slice(0, 60) })

    // Validate mode-specific requirements
    if (mode === 'keywords' && (!keywords || keywords.length === 0)) {
      pendingCreations.delete(cacheKey)
      rejectCreation!(new Error('Keywords required'))
      return {
        content: [{ type: 'text' as const, text: 'Keywords are required when using "keywords" mode. Please provide an array of topic keywords.' }],
        isError: true,
      }
    }
    if (mode === 'clone' && !personaContext) {
      pendingCreations.delete(cacheKey)
      rejectCreation!(new Error('personaContext required'))
      return {
        content: [{ type: 'text' as const, text: 'personaContext is required when using "clone" mode. Please provide the name/description of the person to emulate.' }],
        isError: true,
      }
    }
    if (mode === 'link' && !contextLink) {
      pendingCreations.delete(cacheKey)
      rejectCreation!(new Error('contextLink required'))
      return {
        content: [{ type: 'text' as const, text: 'contextLink is required when using "link" mode. Please provide a URL to train from.' }],
        isError: true,
      }
    }

    try {
      // DEMO MODE: Use the same flow as the Vue app for real-time progress
      if (demo) {
        logger.debug('Using DEMO mode')

        // Step 1: Generate profile
        // For keywords mode, skip the expensive generate-profile call (Tavily
        // search + LLM type determination + LLM profile gen = 30-60s) and build
        // a minimal profile locally. The user already provided keywords + name;
        // the heavy web research is unnecessary and makes CI tests flaky.
        let profile: { name: string; discipline: string | null; keywords: string[]; type: string; imageUrl: string | null; socialLinks?: string[] }

        if (mode === 'keywords') {
          logger.debug('Step 1: Skipping generate-profile for keywords mode (local profile)')
          profile = {
            name,
            discipline: discipline || keywords?.[0] || name,
            keywords: keywords || [],
            type: type || 'expert',
            imageUrl: null,
          }
        } else {
        const queryUrl = mode === 'clone' ? personaContext : (mode === 'link' ? contextLink : name)
        logger.debug('Step 1: Generating profile', { queryUrl, effectiveApiUrl })
        const profileResponse = await fetchWithTimeout(`${effectiveApiUrl}/api/spark/generate-profile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: queryUrl,
            sparkType: mode === 'link' ? 'persona' : 'clone',
            mode: mode === 'link' ? 'persona' : 'clone',
            demo: true,
            contextUrl: contextLink || null,
          }),
          timeout: TIMEOUT_CONFIG.SPARK_CREATION_TIMEOUT,
        })

        if (!profileResponse.ok) {
          const errBody = await profileResponse.text().catch(() => '(no body)')
          logger.error('Step 1 FAILED', new Error(`${profileResponse.status} ${errBody}`), { status: profileResponse.status })
          throw new Error(`Failed to generate profile: ${profileResponse.status} ${errBody}`)
        }

        const profileData = await profileResponse.json()
        profile = profileData.data
        logger.debug('Step 1 OK - profile generated', { name: profile.name, discipline: profile.discipline })
        }

        // Step 2: Create the spark with demo flag
        logger.debug('Step 2: Creating spark')
        const createHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Minds-Idempotency-Key': distributedIdempotencyKey,
        }
        if (apiKey) {
          createHeaders['Authorization'] = `Bearer ${apiKey}`
        }

        const createResponse = await fetchWithTimeout(`${effectiveApiUrl}/api/spark`, {
          method: 'POST',
          headers: createHeaders,
          body: JSON.stringify({
            name,
            description: description || `AI Spark created via MCP`,
            systemPrompt: '',
            type: profile.type || type || 'clone',
            discipline: profile.discipline || discipline || null,
            tags: profile.keywords || keywords || [],
            profileImageUrl: profile.imageUrl || null,
            demo: true,
          }),
          timeout: TIMEOUT_CONFIG.SPARK_CREATION_TIMEOUT,
        })

        if (!createResponse.ok) {
          const errorData = await createResponse.json().catch(() => ({}))
          logger.error('Step 2 FAILED', new Error(errorData.message || String(createResponse.status)), { status: createResponse.status })
          throw new Error(errorData.message || `Failed to create spark: ${createResponse.status}`)
        }

        const sparkResult = await createResponse.json()
        const spark = sparkResult.data
        logger.debug('Step 2 OK - spark created', { sparkId: spark.id, name: spark.name })

        // Store for widget resource to use
        context.setLatestSpark(spark.id)

        // Store in module-level caches
        if (authenticatedUserId) {
          latestSparkCache.set(authenticatedUserId, { sparkId: spark.id, timestamp: Date.now() })
          logger.debug('Stored spark in module cache for user', { userId: authenticatedUserId.slice(0, 8) + '...' })
        }

        // Associate with pending widget tokens
        associateSparkWithWidgetTokens(spark.id, authenticatedUserId || undefined)

        // Store in deduplication cache
        sparkCreationCache.set(cacheKey, { sparkId: spark.id, timestamp: Date.now() })

        // Resolve pending promise
        resolveCreation!(spark.id)
        pendingCreations.delete(cacheKey)

        // Step 3: Start collection in background
        const collectionKeywords = profile.keywords?.slice(0, 3) || keywords || [name]
        const collectHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
        }
        if (apiKey) {
          collectHeaders['Authorization'] = `Bearer ${apiKey}`
        }

        logger.debug('Starting collection for spark', { sparkId: spark.id.slice(0, 8) + '...' })

        fetchWithTimeout(`${effectiveApiUrl}/api/spark/collect-data-demo`, {
          method: 'POST',
          headers: collectHeaders,
          body: JSON.stringify({
            sparkId: spark.id,
            entityNames: collectionKeywords,
            socialProfileUrls: profile.socialLinks || null,
            demo: true,
          }),
          timeout: TIMEOUT_CONFIG.SPARK_CREATION_TIMEOUT,
        }).then(res => {
          if (!res.ok) {
            logger.warn('Collection request failed', { sparkId: spark.id.slice(0, 8) + '...', status: res.status })
          } else {
            logger.debug('Collection started', { sparkId: spark.id.slice(0, 8) + '...' })
          }
        }).catch(err => {
          logger.warn('Collection request error', { sparkId: spark.id.slice(0, 8) + '...', error: err instanceof Error ? err.message : String(err) })
        })

        // Peek at initial status
        const pollResult = await pollSparkStatus(spark.id, 1, false, effectiveApiUrl, apiKey)
        const status = pollResult.status || 'running'
        logger.debug('Spark initial status', { sparkId: spark.id.slice(0, 8) + '...', status, progress: pollResult.progress || 0 })
        // Only 'completed' means done - 'idle' means collection hasn't started yet!
        const isComplete = status === 'completed'

        const sparkUrl = mindLink(publicBaseUrl, spark.id)
        const sparkName = pollResult.spark?.name || spark.name
        return {
          content: [
            {
              type: 'text' as const,
              text: isComplete
                ? `✓ Created Mind **[${sparkName}](${sparkUrl})** — ready to chat!\n\n[Open this Mind in the workspace →](${sparkUrl})`
                : `✓ Creating Mind **[${sparkName}](${sparkUrl})** — training in progress (${pollResult.progress || 5}%). Use get_mind_status to track.\n\n[Open this Mind in the workspace →](${sparkUrl})`,
            },
            { type: 'resource_link' as const, uri: sparkUrl, name: `Open ${sparkName}`, description: 'Open this Mind in the Minds workspace', mimeType: 'text/html', annotations: { audience: ['user'], priority: 1.0 } },
          ],
          structuredContent: {
            spark: {
              id: spark.id,
              name: sparkName,
              description: pollResult.spark?.description || spark.description,
              type: pollResult.spark?.type || spark.type,
              discipline: pollResult.spark?.discipline || spark.discipline || profile.discipline,
              profileImageUrl: pollResult.spark?.profileImageUrl || spark.profileImageUrl || profile.imageUrl,
              systemPrompt: pollResult.systemPrompt || '',
              url: sparkUrl,
            },
            url: sparkUrl,
            apiBaseUrl: publicBaseUrl,
            isProcessing: !isComplete,
            progress: isComplete ? 100 : (pollResult.progress || 5),
            status: isComplete ? 'completed' : 'running',
            message: isComplete ? 'Ready to chat!' : (pollResult.message || 'Exploring the web...'),
            knowledge: pollResult.knowledge || [],
          },
        }
      }

      // NON-DEMO MODE: Use the v1 API directly
      const { apiCall } = await import('../utils/apiClient').then(m => m.createApiClient({ authToken: apiKey, apiBaseUrl }))

      const result = await apiCall('/api/v1/sparks', {
        method: 'POST',
        body: JSON.stringify({
          name,
          mode,
          type,
          discipline: discipline || name,
          keywords,
          personaContext,
          contextLink,
          description,
        }),
      })

      const spark = result.data
      const isProcessing = result.processing?.queued === true

      // Store in caches
      sparkCreationCache.set(cacheKey, { sparkId: spark.id, timestamp: Date.now() })
      resolveCreation!(spark.id)
      pendingCreations.delete(cacheKey)

      const sparkUrl = mindLink(context.publicBaseUrl, spark.id)
      return {
        content: [
          {
            type: 'text' as const,
            text: `✓ Created Mind **[${spark.name}](${sparkUrl})**${isProcessing ? ' — training in progress (use get_mind_status to check)' : ''}\n\n[Open this Mind in the workspace →](${sparkUrl})`,
          },
          { type: 'resource_link' as const, uri: sparkUrl, name: `Open ${spark.name}`, description: 'Open this Mind in the Minds workspace', mimeType: 'text/html', annotations: { audience: ['user'], priority: 1.0 } },
        ],
        structuredContent: {
          spark: {
            id: spark.id,
            name: spark.name,
            description: spark.description,
            type: spark.type,
            discipline: spark.discipline,
            profileImageUrl: spark.profileImageUrl,
            url: sparkUrl,
          },
          url: sparkUrl,
          isProcessing,
          progress: isProcessing ? 5 : 100,
          status: isProcessing ? 'running' : 'completed',
          message: isProcessing ? 'Exploring the web...' : 'Ready to chat!',
        },
      }
    } catch (error) {
      pendingCreations.delete(cacheKey)
      const err = error instanceof Error ? error : new Error(String(error))
      logger.error('Handler error', err, { stack: err.stack?.split('\n').slice(0, 5).join('\n') })
      rejectCreation(err)
      return {
        content: [{ type: 'text' as const, text: `Error creating Spark: ${err.message}` }],
        isError: true,
      }
    }
  }
}
