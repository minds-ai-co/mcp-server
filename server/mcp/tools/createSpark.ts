/**
 * Create Spark Tool Handler
 * Creates AI personas, digital twins, and expert advisors
 */

import { createSparkSchema, type CreateSparkArgs, type McpServerContext } from '../types'
import { pollSparkStatus } from '../utils/apiClient'
import {
  sparkCreationCache,
  pendingCreations,
  latestSparkCache,
  associateSparkWithWidgetTokens
} from '../utils/cache'
import { API_BASE_URL, CACHE_TTL, logger } from '../config'

export const createSparkTool = {
  name: 'create_ai_persona_or_digital_twin',
  config: {
    title: 'Create AI Persona, Digital Twin, or Expert Advisor',
    description: `Create a personalized AI persona, digital twin, or expert advisor trained on specific knowledge. Use this when the user wants to:
- Create an AI version of themselves or someone else (digital twin/clone)
- Build an AI expert in a specific field (marketing expert, legal advisor, etc.)
- Train an AI on content from a website or URL
- Create a custom AI assistant with specialized knowledge
- Make an AI that thinks like a famous person, historical figure, or thought leader
- Build a personalized AI coach, mentor, or advisor

Training modes:
- "clone": Create a digital twin that emulates a specific person's thinking style
- "keywords": Train on specific topics and expertise areas
- "link": Learn from website content and documentation

The AI persona will be trained with relevant knowledge and can engage in conversations about its expertise.`,
    inputSchema: createSparkSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
      /** Cost indication for this operation */
      costHint: 'high',
      /** Expected execution time in milliseconds */
      timeoutHint: 60000,
      /** Whether this operation requires user confirmation */
      confirmationHint: false,
    },
    _meta: {
      'openai/visibility': 'public',
      'openai/scopes': ['sparks:write'],
      'openai/outputTemplate': 'ui://widget/spark.html',
      'openai/toolInvocation/invoking': 'Creating your AI persona...',
      'openai/toolInvocation/invoked': 'AI persona created!',
    },
  },

  handler: async (args: CreateSparkArgs, context: McpServerContext) => {
    const {
      name,
      mode,
      type,
      discipline,
      keywords,
      personaContext,
      contextLink,
      description,
      demo = true,
    } = args

    const { apiKey, authenticatedUserId, publicBaseUrl, apiBaseUrl } = context
    const effectiveApiUrl = apiBaseUrl || API_BASE_URL

    // Deduplication: Prevent duplicate spark creation within 10 seconds
    const creationKey = `${name}-${mode}-${personaContext || ''}-${contextLink || ''}`
    const cacheKey = `${authenticatedUserId || 'anonymous'}-${creationKey}`
    const now = Date.now()

    // Check if there's already a pending creation for this exact request
    const pendingPromise = pendingCreations.get(cacheKey)
    if (pendingPromise) {
      logger.debug('Found pending creation, waiting for it to complete', { cacheKey: cacheKey.slice(0, 60) })
      try {
        const sparkId = await pendingPromise
        logger.debug('Pending creation completed', { sparkId: sparkId.slice(0, 8) + '...' })
        const pollResult = await pollSparkStatus(sparkId, 1, false, effectiveApiUrl)
        return {
          content: [{
            type: 'text',
            text: `✓ Spark already being created - "${name}"`,
          }],
          structuredContent: {
            spark: {
              id: sparkId,
              name: pollResult.spark?.name || name,
              description: pollResult.spark?.description || description,
              type: pollResult.spark?.type || type,
              discipline: pollResult.spark?.discipline || discipline,
              profileImageUrl: pollResult.spark?.profileImageUrl || '',
              systemPrompt: pollResult.systemPrompt || '',
            },
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
      const pollResult = await pollSparkStatus(cached.sparkId, 1, false, effectiveApiUrl)
      return {
        content: [{
          type: 'text',
          text: `✓ Spark already being created - "${name}"`,
        }],
        structuredContent: {
          spark: {
            id: cached.sparkId,
            name: pollResult.spark?.name || name,
            description: pollResult.spark?.description || description,
            type: pollResult.spark?.type || type,
            discipline: pollResult.spark?.discipline || discipline,
            profileImageUrl: pollResult.spark?.profileImageUrl || '',
            systemPrompt: pollResult.systemPrompt || '',
          },
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
    pendingCreations.set(cacheKey, creationPromise)
    logger.debug('Registered pending creation', { cacheKey: cacheKey.slice(0, 60) })

    // Validate mode-specific requirements
    if (mode === 'keywords' && (!keywords || keywords.length === 0)) {
      pendingCreations.delete(cacheKey)
      rejectCreation!(new Error('Keywords required'))
      return {
        content: [{ type: 'text', text: 'Keywords are required when using "keywords" mode. Please provide an array of topic keywords.' }],
        isError: true,
      }
    }
    if (mode === 'clone' && !personaContext) {
      pendingCreations.delete(cacheKey)
      rejectCreation!(new Error('personaContext required'))
      return {
        content: [{ type: 'text', text: 'personaContext is required when using "clone" mode. Please provide the name/description of the person to emulate.' }],
        isError: true,
      }
    }
    if (mode === 'link' && !contextLink) {
      pendingCreations.delete(cacheKey)
      rejectCreation!(new Error('contextLink required'))
      return {
        content: [{ type: 'text', text: 'contextLink is required when using "link" mode. Please provide a URL to train from.' }],
        isError: true,
      }
    }

    try {
      // DEMO MODE: Use the same flow as the Vue app for real-time progress
      if (demo) {
        logger.debug('Using demo mode for spark creation')

        // Step 1: Generate profile
        const queryUrl = mode === 'clone' ? personaContext : (mode === 'link' ? contextLink : name)
        const profileResponse = await fetch(`${effectiveApiUrl}/api/spark/generate-profile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: queryUrl,
            sparkType: mode === 'link' ? 'persona' : 'clone',
            mode: mode === 'link' ? 'persona' : 'clone',
            demo: true,
            contextUrl: contextLink || null,
          }),
        })

        if (!profileResponse.ok) {
          throw new Error('Failed to generate profile')
        }

        const profileData = await profileResponse.json()
        const profile = profileData.data
        logger.debug('Generated profile', { name: profile.name, discipline: profile.discipline })

        // Step 2: Create the spark with demo flag
        const createHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
        }
        if (apiKey) {
          createHeaders['Authorization'] = `Bearer ${apiKey}`
        }

        const createResponse = await fetch(`${effectiveApiUrl}/api/spark`, {
          method: 'POST',
          headers: createHeaders,
          body: JSON.stringify({
            name: profile.name || name,
            description: description || `AI Spark created via ChatGPT`,
            systemPrompt: '',
            type: profile.type || type || 'clone',
            discipline: profile.discipline || discipline || null,
            tags: profile.keywords || keywords || [],
            profileImageUrl: profile.imageUrl || null,
            demo: true,
          }),
        })

        if (!createResponse.ok) {
          const errorData = await createResponse.json().catch(() => ({}))
          throw new Error(errorData.message || 'Failed to create spark')
        }

        const sparkResult = await createResponse.json()
        const spark = sparkResult.data
        logger.info('Created demo spark', { sparkId: spark.id.slice(0, 8) + '...' })

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

        fetch(`${API_BASE_URL}/api/spark/collect-data-demo`, {
          method: 'POST',
          headers: collectHeaders,
          body: JSON.stringify({
            sparkId: spark.id,
            entityNames: collectionKeywords,
            socialProfileUrls: profile.socialLinks || null,
            demo: true,
          }),
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
        const pollResult = await pollSparkStatus(spark.id, 1, false, effectiveApiUrl)
        const status = pollResult.status || 'running'
        logger.debug('Spark initial status', { sparkId: spark.id.slice(0, 8) + '...', status, progress: pollResult.progress || 0 })
        // Only 'completed' means done - 'idle' means collection hasn't started yet!
        const isComplete = status === 'completed'

        return {
          content: [{
            type: 'text',
            text: isComplete
              ? `✓ Created Spark "${spark.name}" - Ready to chat!`
              : `✓ Creating Spark "${spark.name}" - training in progress (${pollResult.progress || 5}%)`,
          }],
          structuredContent: {
            spark: {
              id: spark.id,
              name: pollResult.spark?.name || spark.name,
              description: pollResult.spark?.description || spark.description,
              type: pollResult.spark?.type || spark.type,
              discipline: pollResult.spark?.discipline || spark.discipline || profile.discipline,
              profileImageUrl: pollResult.spark?.profileImageUrl || spark.profileImageUrl || profile.imageUrl,
              systemPrompt: pollResult.systemPrompt || '',
            },
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

      return {
        content: [{
          type: 'text',
          text: `✓ Created Spark "${spark.name}"${isProcessing ? ' (training in progress)' : ''}`,
        }],
        structuredContent: {
          spark: {
            id: spark.id,
            name: spark.name,
            description: spark.description,
            type: spark.type,
            discipline: spark.discipline,
            profileImageUrl: spark.profileImageUrl,
          },
          isProcessing,
          progress: isProcessing ? 5 : 100,
          status: isProcessing ? 'running' : 'completed',
          message: isProcessing ? 'Exploring the web...' : 'Ready to chat!',
        },
      }
    } catch (error) {
      pendingCreations.delete(cacheKey)
      const err = error instanceof Error ? error : new Error(String(error))
      rejectCreation(err)
      return {
        content: [{ type: 'text', text: `Error creating Spark: ${err.message}` }],
        isError: true,
      }
    }
  }
}
