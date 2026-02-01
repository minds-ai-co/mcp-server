/**
 * Audit Logging for MCP Server
 * Structured logging for security monitoring and compliance
 */

import { logger, isProduction } from '../config'

/**
 * Audit event types
 */
export type AuditEventType =
  | 'auth.attempt'
  | 'auth.success'
  | 'auth.failure'
  | 'tool.invoke'
  | 'tool.success'
  | 'tool.failure'
  | 'resource.access'
  | 'rate_limit.exceeded'
  | 'error.internal'

/**
 * Audit event severity levels
 */
export type AuditSeverity = 'info' | 'warn' | 'error' | 'critical'

/**
 * Audit event data
 */
export interface AuditEvent {
  type: AuditEventType
  severity: AuditSeverity
  timestamp: string
  requestId?: string
  userId?: string
  ip?: string
  userAgent?: string
  tool?: string
  resource?: string
  method?: string
  success?: boolean
  error?: string
  duration?: number
  metadata?: Record<string, unknown>
}

/**
 * Sensitive field patterns to mask in logs
 */
const SENSITIVE_PATTERNS = [
  /token/i,
  /key/i,
  /secret/i,
  /password/i,
  /auth/i,
  /credential/i,
  /bearer/i,
]

/**
 * Mask sensitive values in an object
 */
function maskSensitiveData(obj: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(obj)) {
    // Check if key matches sensitive patterns
    const isSensitive = SENSITIVE_PATTERNS.some(pattern => pattern.test(key))

    if (isSensitive && typeof value === 'string') {
      // Mask the value, keeping first and last 4 chars if long enough
      if (value.length > 12) {
        masked[key] = `${value.slice(0, 4)}****${value.slice(-4)}`
      } else if (value.length > 4) {
        masked[key] = `${value.slice(0, 2)}****`
      } else {
        masked[key] = '****'
      }
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Recursively mask nested objects
      masked[key] = maskSensitiveData(value as Record<string, unknown>)
    } else {
      masked[key] = value
    }
  }

  return masked
}

/**
 * Truncate long string values
 */
function truncateValue(value: unknown, maxLength: number = 200): unknown {
  if (typeof value === 'string' && value.length > maxLength) {
    return value.slice(0, maxLength) + '...'
  }
  return value
}

/**
 * Audit logger class
 */
class AuditLogger {
  private buffer: AuditEvent[] = []
  private flushInterval: NodeJS.Timeout | null = null
  private maxBufferSize = 100
  private flushIntervalMs = 5000

  constructor() {
    // In production, set up periodic flushing
    if (isProduction) {
      this.startPeriodicFlush()
    }
  }

  /**
   * Start periodic buffer flush
   */
  private startPeriodicFlush(): void {
    this.flushInterval = setInterval(() => {
      this.flush()
    }, this.flushIntervalMs)

    if (this.flushInterval.unref) {
      this.flushInterval.unref()
    }
  }

  /**
   * Stop periodic flushing
   */
  destroy(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval)
      this.flushInterval = null
    }
    this.flush()
  }

  /**
   * Flush buffered events
   */
  private flush(): void {
    if (this.buffer.length === 0) return

    // In production, you would send these to a logging service
    // For now, we batch log them
    const events = this.buffer.splice(0, this.buffer.length)

    // Log each event
    for (const event of events) {
      this.writeEvent(event)
    }
  }

  /**
   * Write a single event to the log
   */
  private writeEvent(event: AuditEvent): void {
    const logData = maskSensitiveData(event as unknown as Record<string, unknown>)

    // Truncate metadata values
    if (logData.metadata && typeof logData.metadata === 'object') {
      const truncatedMetadata: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(logData.metadata)) {
        truncatedMetadata[key] = truncateValue(value)
      }
      logData.metadata = truncatedMetadata
    }

    const logLine = JSON.stringify(logData)

    switch (event.severity) {
      case 'critical':
      case 'error':
        logger.error(`[AUDIT] ${logLine}`)
        break
      case 'warn':
        logger.warn(`[AUDIT] ${logLine}`)
        break
      default:
        logger.info(`[AUDIT] ${logLine}`)
    }
  }

  /**
   * Log an audit event
   */
  log(event: Omit<AuditEvent, 'timestamp'>): void {
    const fullEvent: AuditEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    }

    if (isProduction) {
      // Buffer events in production
      this.buffer.push(fullEvent)
      if (this.buffer.length >= this.maxBufferSize) {
        this.flush()
      }
    } else {
      // Write immediately in development
      this.writeEvent(fullEvent)
    }
  }

  /**
   * Log authentication attempt
   */
  authAttempt(data: {
    requestId?: string
    ip?: string
    userAgent?: string
    method?: string
  }): void {
    this.log({
      type: 'auth.attempt',
      severity: 'info',
      ...data,
    })
  }

  /**
   * Log successful authentication
   */
  authSuccess(data: {
    requestId?: string
    userId: string
    ip?: string
    userAgent?: string
  }): void {
    this.log({
      type: 'auth.success',
      severity: 'info',
      success: true,
      ...data,
    })
  }

  /**
   * Log failed authentication
   */
  authFailure(data: {
    requestId?: string
    ip?: string
    userAgent?: string
    error?: string
  }): void {
    this.log({
      type: 'auth.failure',
      severity: 'warn',
      success: false,
      ...data,
    })
  }

  /**
   * Log tool invocation
   */
  toolInvoke(data: {
    requestId?: string
    userId?: string
    tool: string
    ip?: string
    metadata?: Record<string, unknown>
  }): void {
    this.log({
      type: 'tool.invoke',
      severity: 'info',
      ...data,
    })
  }

  /**
   * Log successful tool execution
   */
  toolSuccess(data: {
    requestId?: string
    userId?: string
    tool: string
    duration?: number
    metadata?: Record<string, unknown>
  }): void {
    this.log({
      type: 'tool.success',
      severity: 'info',
      success: true,
      ...data,
    })
  }

  /**
   * Log failed tool execution
   */
  toolFailure(data: {
    requestId?: string
    userId?: string
    tool: string
    error: string
    duration?: number
  }): void {
    this.log({
      type: 'tool.failure',
      severity: 'error',
      success: false,
      ...data,
    })
  }

  /**
   * Log resource access
   */
  resourceAccess(data: {
    requestId?: string
    userId?: string
    resource: string
    ip?: string
  }): void {
    this.log({
      type: 'resource.access',
      severity: 'info',
      ...data,
    })
  }

  /**
   * Log rate limit exceeded
   */
  rateLimitExceeded(data: {
    requestId?: string
    userId?: string
    ip?: string
    method?: string
    tool?: string
  }): void {
    this.log({
      type: 'rate_limit.exceeded',
      severity: 'warn',
      ...data,
    })
  }

  /**
   * Log internal error
   */
  internalError(data: {
    requestId?: string
    userId?: string
    error: string
    metadata?: Record<string, unknown>
  }): void {
    this.log({
      type: 'error.internal',
      severity: 'error',
      ...data,
    })
  }
}

// Singleton instance
export const audit = new AuditLogger()
