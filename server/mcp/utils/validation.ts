/**
 * Input Validation and Sanitization for MCP Server
 * Validates and sanitizes tool inputs before processing
 */

import { z } from 'zod'
import { logger } from '../config'

/**
 * UUID validation regex (v4)
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * URL validation with allowed protocols
 */
const ALLOWED_URL_PROTOCOLS = ['http:', 'https:']

/**
 * Maximum string lengths for various inputs
 */
export const MAX_LENGTHS = {
  name: 200,
  description: 2000,
  message: 10000,
  url: 2048,
  searchQuery: 500,
  personaContext: 5000,
  keyword: 100,
  conversationHistory: 50,  // max messages
} as const

/**
 * Characters that could be used for injection attacks
 */
const DANGEROUS_PATTERNS = [
  /<script\b[^>]*>/i,
  /javascript:/i,
  /data:/i,
  /vbscript:/i,
  /on\w+=/i,
]

/**
 * Validation result
 */
export interface ValidationResult<T = unknown> {
  valid: boolean
  data?: T
  errors?: string[]
}

/**
 * Validate a UUID string
 */
export function validateUuid(value: string | undefined, fieldName: string): ValidationResult<string> {
  if (!value) {
    return { valid: false, errors: [`${fieldName} is required`] }
  }

  if (!UUID_REGEX.test(value)) {
    return { valid: false, errors: [`${fieldName} must be a valid UUID`] }
  }

  return { valid: true, data: value.toLowerCase() }
}

/**
 * Validate and sanitize a URL
 */
export function validateUrl(
  value: string | undefined,
  fieldName: string,
  required: boolean = false
): ValidationResult<string> {
  if (!value) {
    if (required) {
      return { valid: false, errors: [`${fieldName} is required`] }
    }
    return { valid: true, data: undefined }
  }

  // Check length
  if (value.length > MAX_LENGTHS.url) {
    return { valid: false, errors: [`${fieldName} exceeds maximum length of ${MAX_LENGTHS.url}`] }
  }

  // Try to parse URL
  let url: URL
  try {
    url = new URL(value)
  } catch (_) {
    return { valid: false, errors: [`${fieldName} is not a valid URL`] }
  }

  // Check protocol
  if (!ALLOWED_URL_PROTOCOLS.includes(url.protocol)) {
    return { valid: false, errors: [`${fieldName} must use HTTP or HTTPS protocol`] }
  }

  // Check for dangerous patterns in URL
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(value)) {
      logger.warn('Dangerous pattern detected in URL', { fieldName, pattern: pattern.toString() })
      return { valid: false, errors: [`${fieldName} contains potentially dangerous content`] }
    }
  }

  return { valid: true, data: url.toString() }
}

/**
 * Sanitize and validate a string input
 */
export function validateString(
  value: string | undefined,
  fieldName: string,
  options: {
    required?: boolean
    maxLength?: number
    minLength?: number
    pattern?: RegExp
  } = {}
): ValidationResult<string> {
  const { required = false, maxLength, minLength, pattern } = options

  if (value === undefined || value === null) {
    if (required) {
      return { valid: false, errors: [`${fieldName} is required`] }
    }
    return { valid: true, data: undefined }
  }

  if (typeof value !== 'string') {
    return { valid: false, errors: [`${fieldName} must be a string`] }
  }

  // Trim whitespace
  const trimmed = value.trim()

  if (required && trimmed.length === 0) {
    return { valid: false, errors: [`${fieldName} cannot be empty`] }
  }

  if (maxLength && trimmed.length > maxLength) {
    return { valid: false, errors: [`${fieldName} exceeds maximum length of ${maxLength}`] }
  }

  if (minLength && trimmed.length < minLength) {
    return { valid: false, errors: [`${fieldName} must be at least ${minLength} characters`] }
  }

  if (pattern && !pattern.test(trimmed)) {
    return { valid: false, errors: [`${fieldName} has invalid format`] }
  }

  // Check for dangerous patterns
  for (const dangerousPattern of DANGEROUS_PATTERNS) {
    if (dangerousPattern.test(trimmed)) {
      logger.warn('Dangerous pattern detected in input', { fieldName, pattern: dangerousPattern.toString() })
      return { valid: false, errors: [`${fieldName} contains potentially dangerous content`] }
    }
  }

  return { valid: true, data: trimmed }
}

/**
 * Validate an array of strings
 */
export function validateStringArray(
  value: unknown,
  fieldName: string,
  options: {
    required?: boolean
    maxItems?: number
    maxItemLength?: number
  } = {}
): ValidationResult<string[]> {
  const { required = false, maxItems, maxItemLength = MAX_LENGTHS.keyword } = options

  if (value === undefined || value === null) {
    if (required) {
      return { valid: false, errors: [`${fieldName} is required`] }
    }
    return { valid: true, data: undefined }
  }

  if (!Array.isArray(value)) {
    return { valid: false, errors: [`${fieldName} must be an array`] }
  }

  if (maxItems && value.length > maxItems) {
    return { valid: false, errors: [`${fieldName} exceeds maximum of ${maxItems} items`] }
  }

  const errors: string[] = []
  const sanitized: string[] = []

  for (let i = 0; i < value.length; i++) {
    const result = validateString(value[i], `${fieldName}[${i}]`, { maxLength: maxItemLength })
    if (!result.valid) {
      errors.push(...(result.errors || []))
    } else if (result.data) {
      sanitized.push(result.data)
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return { valid: true, data: sanitized }
}

/**
 * Validate conversation history
 */
export function validateConversationHistory(
  value: unknown,
  fieldName: string = 'conversationHistory'
): ValidationResult<Array<{ role: 'user' | 'assistant'; content: string }>> {
  if (value === undefined || value === null) {
    return { valid: true, data: undefined }
  }

  if (!Array.isArray(value)) {
    return { valid: false, errors: [`${fieldName} must be an array`] }
  }

  if (value.length > MAX_LENGTHS.conversationHistory) {
    return { valid: false, errors: [`${fieldName} exceeds maximum of ${MAX_LENGTHS.conversationHistory} messages`] }
  }

  const errors: string[] = []
  const sanitized: Array<{ role: 'user' | 'assistant'; content: string }> = []

  for (let i = 0; i < value.length; i++) {
    const msg = value[i]

    if (!msg || typeof msg !== 'object') {
      errors.push(`${fieldName}[${i}] must be an object`)
      continue
    }

    const role = msg.role
    if (role !== 'user' && role !== 'assistant') {
      errors.push(`${fieldName}[${i}].role must be "user" or "assistant"`)
      continue
    }

    const contentResult = validateString(msg.content, `${fieldName}[${i}].content`, {
      required: true,
      maxLength: MAX_LENGTHS.message,
    })

    if (!contentResult.valid) {
      errors.push(...(contentResult.errors || []))
      continue
    }

    sanitized.push({ role, content: contentResult.data! })
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return { valid: true, data: sanitized }
}

/**
 * Validate create spark arguments
 */
export function validateCreateSparkArgs(args: Record<string, unknown>): ValidationResult<{
  name: string
  mode: 'keywords' | 'clone' | 'link' | 'manual'
  type?: 'creative' | 'expert' | 'user'
  discipline?: string
  keywords?: string[]
  personaContext?: string
  contextLink?: string
  description?: string
  demo?: boolean
}> {
  const errors: string[] = []

  // Validate name (required)
  const nameResult = validateString(args.name as string, 'name', {
    required: true,
    minLength: 1,
    maxLength: MAX_LENGTHS.name,
  })
  if (!nameResult.valid) errors.push(...(nameResult.errors || []))

  // Validate mode (required)
  const validModes = ['keywords', 'clone', 'link', 'manual']
  if (!validModes.includes(args.mode as string)) {
    errors.push('mode must be one of: keywords, clone, link, manual')
  }

  // Validate type (optional)
  const validTypes = ['creative', 'expert', 'user']
  if (args.type && !validTypes.includes(args.type as string)) {
    errors.push('type must be one of: creative, expert, user')
  }

  // Validate discipline (optional)
  const disciplineResult = validateString(args.discipline as string, 'discipline', {
    maxLength: MAX_LENGTHS.name,
  })
  if (!disciplineResult.valid) errors.push(...(disciplineResult.errors || []))

  // Validate keywords (optional)
  const keywordsResult = validateStringArray(args.keywords, 'keywords', {
    maxItems: 20,
    maxItemLength: MAX_LENGTHS.keyword,
  })
  if (!keywordsResult.valid) errors.push(...(keywordsResult.errors || []))

  // Validate personaContext (optional)
  const personaContextResult = validateString(args.personaContext as string, 'personaContext', {
    maxLength: MAX_LENGTHS.personaContext,
  })
  if (!personaContextResult.valid) errors.push(...(personaContextResult.errors || []))

  // Validate contextLink (optional URL)
  const contextLinkResult = validateUrl(args.contextLink as string, 'contextLink')
  if (!contextLinkResult.valid) errors.push(...(contextLinkResult.errors || []))

  // Validate description (optional)
  const descriptionResult = validateString(args.description as string, 'description', {
    maxLength: MAX_LENGTHS.description,
  })
  if (!descriptionResult.valid) errors.push(...(descriptionResult.errors || []))

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return {
    valid: true,
    data: {
      name: nameResult.data!,
      mode: args.mode as 'keywords' | 'clone' | 'link' | 'manual',
      type: args.type as 'creative' | 'expert' | 'user' | undefined,
      discipline: disciplineResult.data,
      keywords: keywordsResult.data,
      personaContext: personaContextResult.data,
      contextLink: contextLinkResult.data,
      description: descriptionResult.data,
      demo: args.demo !== false,
    },
  }
}

/**
 * Validate chat with spark arguments
 */
export function validateChatWithSparkArgs(args: Record<string, unknown>): ValidationResult<{
  sparkId?: string
  sparkName?: string
  message: string
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
}> {
  const errors: string[] = []

  // Validate sparkId (optional UUID)
  if (args.sparkId) {
    const sparkIdResult = validateUuid(args.sparkId as string, 'sparkId')
    if (!sparkIdResult.valid) errors.push(...(sparkIdResult.errors || []))
  }

  // Validate sparkName (optional)
  const sparkNameResult = validateString(args.sparkName as string, 'sparkName', {
    maxLength: MAX_LENGTHS.name,
  })
  if (!sparkNameResult.valid) errors.push(...(sparkNameResult.errors || []))

  // Require either sparkId or sparkName
  if (!args.sparkId && !args.sparkName) {
    errors.push('Either sparkId or sparkName is required')
  }

  // Validate message (required)
  const messageResult = validateString(args.message as string, 'message', {
    required: true,
    minLength: 1,
    maxLength: MAX_LENGTHS.message,
  })
  if (!messageResult.valid) errors.push(...(messageResult.errors || []))

  // Validate conversation history
  const historyResult = validateConversationHistory(args.conversationHistory)
  if (!historyResult.valid) errors.push(...(historyResult.errors || []))

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return {
    valid: true,
    data: {
      sparkId: args.sparkId as string | undefined,
      sparkName: sparkNameResult.data,
      message: messageResult.data!,
      conversationHistory: historyResult.data,
    },
  }
}

/**
 * Validate list sparks arguments
 */
export function validateListSparksArgs(args: Record<string, unknown>): ValidationResult<{
  searchQuery?: string
}> {
  const errors: string[] = []

  const searchQueryResult = validateString(args.searchQuery as string, 'searchQuery', {
    maxLength: MAX_LENGTHS.searchQuery,
  })
  if (!searchQueryResult.valid) errors.push(...(searchQueryResult.errors || []))

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return {
    valid: true,
    data: {
      searchQuery: searchQueryResult.data,
    },
  }
}

/**
 * Validate get spark status arguments
 */
export function validateGetSparkStatusArgs(args: Record<string, unknown>): ValidationResult<{
  sparkId: string
}> {
  const sparkIdResult = validateUuid(args.sparkId as string, 'sparkId')

  if (!sparkIdResult.valid) {
    return { valid: false, errors: sparkIdResult.errors }
  }

  return {
    valid: true,
    data: {
      sparkId: sparkIdResult.data!,
    },
  }
}
