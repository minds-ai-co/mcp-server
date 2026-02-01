/**
 * MCP Server Configuration
 * Centralized configuration for the MCP server module
 */

/**
 * Environment detection
 */
export const isDevelopment = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === undefined
export const isProduction = process.env.NODE_ENV === 'production'

/**
 * API Configuration
 * Internal API calls always use localhost to avoid proxy loops (ngrok, etc.)
 */
export const API_BASE_URL = 'http://localhost:3000'

/**
 * CORS Configuration
 * Whitelist of allowed origins for MCP requests
 */
export const CORS_CONFIG = {
  // Allowed origins for MCP requests
  allowedOrigins: [
    // ChatGPT
    'https://chat.openai.com',
    'https://chatgpt.com',
    // Claude
    'https://claude.ai',
    // Minds AI
    'https://art-of-x.com',
    'https://staging.art-of-x.com',
    'https://getminds.ai',
    'https://staging.getminds.ai',
    'https://api.getminds.ai',
    'http://api.getminds.ai',
    // Development
    ...(isDevelopment ? [
      'http://localhost:3000',
      'http://localhost:5173',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173',
    ] : []),
  ],

  // Allow any origin in development or for specific patterns
  allowedPatterns: [
    /^https:\/\/.*\.openai\.com$/,
    /^https:\/\/.*\.chatgpt\.com$/,
    /^https:\/\/.*\.anthropic\.com$/,
    /^https:\/\/.*\.claude\.ai$/,
    /^https:\/\/.*\.ngrok(-free)?\.app$/,  // ngrok tunnels
    /^https:\/\/(staging\.)?art-of-x\.com$/,  // art-of-x.com (legacy)
    /^https:\/\/(staging\.)?getminds\.ai$/,  // getminds.ai (primary)
    /^https?:\/\/(api\.)?getminds\.ai$/,     // api.getminds.ai (MCP API)
  ],

  // Methods and headers
  allowedMethods: ['POST', 'GET', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['content-type', 'mcp-session-id', 'authorization', 'accept'],
  exposedHeaders: ['Mcp-Session-Id'],
}

/**
 * Check if an origin is allowed
 */
export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) {
    // Allow requests without origin (same-origin, curl, etc.)
    return true
  }

  // Check exact matches
  if (CORS_CONFIG.allowedOrigins.includes(origin)) {
    return true
  }

  // Check patterns
  return CORS_CONFIG.allowedPatterns.some(pattern => pattern.test(origin))
}

/**
 * Get CORS headers for a request
 */
export function getCorsHeaders(origin: string | undefined): Record<string, string> {
  const allowed = isOriginAllowed(origin)

  if (!allowed && isProduction) {
    // In production, reject unknown origins
    return {}
  }

  // In development or for allowed origins, return permissive headers
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': CORS_CONFIG.allowedMethods.join(', '),
    'Access-Control-Allow-Headers': CORS_CONFIG.allowedHeaders.join(', '),
    'Access-Control-Expose-Headers': CORS_CONFIG.exposedHeaders.join(', '),
  }
}

/**
 * Cache TTL Configuration (in milliseconds)
 */
export const CACHE_TTL = {
  /** Spark creation deduplication cache - prevents duplicate creates within this window */
  SPARK_CREATION: 10 * 1000,           // 10 seconds

  /** OAuth token validation cache - avoids re-validating on every request */
  TOKEN_VALIDATION: 60 * 1000,         // 1 minute

  /** Latest spark cache - remembers user's most recent spark for widget discovery */
  LATEST_SPARK: 30 * 60 * 1000,        // 30 minutes

  /** Widget token cache - correlates widget requests with tool calls */
  WIDGET_TOKEN: 5 * 60 * 1000,         // 5 minutes

  /** Recent spark association window - links sparks to widgets created around same time */
  RECENT_SPARK_ASSOCIATION: 30 * 1000, // 30 seconds

  /** Batch slot counter reset - when to start fresh slot allocation */
  BATCH_SLOT_RESET: 30 * 1000,         // 30 seconds
} as const

/**
 * Rate Limiting Configuration
 */
export const RATE_LIMIT_CONFIG = {
  /** Max requests per window for unauthenticated users (per IP) */
  unauthenticatedLimit: 100,
  /** Max requests per window for authenticated users */
  authenticatedLimit: 1000,
  /** Time window in milliseconds */
  windowMs: 60 * 1000, // 1 minute
  /** Stricter limits for specific operations */
  operationLimits: {
    'create_ai_persona_or_digital_twin': 20,
    'talk_to_ai_persona': 60,
    'tools/call': 100,
  } as Record<string, number>,
} as const

/**
 * Timeout Configuration (in milliseconds)
 */
export const TIMEOUT_CONFIG = {
  /** Default timeout for API calls */
  DEFAULT_API_TIMEOUT: 30000,          // 30 seconds
  /** Timeout for spark creation */
  SPARK_CREATION_TIMEOUT: 60000,       // 60 seconds
  /** Timeout for chat completion */
  CHAT_COMPLETION_TIMEOUT: 45000,      // 45 seconds
  /** Timeout for polling operations */
  POLLING_TIMEOUT: 5000,               // 5 seconds
} as const

/**
 * Circuit Breaker Configuration
 */
export const CIRCUIT_BREAKER_CONFIG = {
  /** Number of failures before opening the circuit */
  failureThreshold: 5,
  /** Time in ms to wait before trying again (half-open state) */
  resetTimeout: 30000, // 30 seconds
  /** Number of successful calls needed to close the circuit from half-open */
  successThreshold: 2,
} as const

/**
 * Polling Configuration
 */
export const POLLING_CONFIG = {
  /** Default max attempts for polling operations */
  DEFAULT_MAX_ATTEMPTS: 30,

  /** Interval between poll attempts */
  POLL_INTERVAL_MS: 2000,

  /** Widget loading timeout */
  WIDGET_LOAD_TIMEOUT_MS: 5000,
} as const

/**
 * Logging utility
 * Structured logging with environment awareness
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  [key: string]: unknown
}

class McpLogger {
  private prefix = '[MCP]'

  private shouldLog(level: LogLevel): boolean {
    if (level === 'error' || level === 'warn') return true
    if (level === 'info') return true
    // Debug only in development
    return isDevelopment
  }

  private formatContext(context?: LogContext): string {
    if (!context || Object.keys(context).length === 0) return ''

    // Mask sensitive values
    const masked = { ...context }
    for (const key of Object.keys(masked)) {
      const lowerKey = key.toLowerCase()
      if (lowerKey.includes('token') || lowerKey.includes('key') || lowerKey.includes('secret')) {
        const value = masked[key]
        if (typeof value === 'string' && value.length > 8) {
          masked[key] = `${value.slice(0, 4)}...${value.slice(-4)}`
        }
      }
    }

    return ' ' + JSON.stringify(masked)
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog('debug')) {
      console.debug(`${this.prefix} ${message}${this.formatContext(context)}`)
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog('info')) {
      console.log(`${this.prefix} ${message}${this.formatContext(context)}`)
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog('warn')) {
      console.warn(`${this.prefix} ${message}${this.formatContext(context)}`)
    }
  }

  error(message: string, error?: unknown, context?: LogContext): void {
    if (this.shouldLog('error')) {
      const errorInfo = error instanceof Error ? { error: error.message, stack: error.stack } : { error }
      console.error(`${this.prefix} ${message}${this.formatContext({ ...context, ...errorInfo })}`)
    }
  }
}

export const logger = new McpLogger()

/**
 * Public methods that don't require authentication
 * Used for ChatGPT connector setup and discovery
 */
export const PUBLIC_METHODS = [
  'initialize',
  'notifications/initialized',
  'tools/list',
  'resources/list',
  'resources/read',
  'prompts/list',
  'ping',
] as const

/**
 * Tools that can be called without authentication (demo mode)
 */
export const PUBLIC_TOOLS = [
  'create_ai_persona_or_digital_twin',
] as const

/**
 * Check if a method is public (doesn't require auth)
 */
export function isPublicMethod(method: string): boolean {
  return PUBLIC_METHODS.includes(method as any)
}

/**
 * Check if a tool is public (can be called without auth)
 */
export function isPublicTool(toolName: string): boolean {
  return PUBLIC_TOOLS.includes(toolName as any)
}
