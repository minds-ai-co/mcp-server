/**
 * Standardized Error Handling for MCP Server
 * Implements MCP protocol error codes and structured error responses
 */

/**
 * MCP Standard Error Codes
 * Based on JSON-RPC 2.0 and MCP specification
 */
export const MCP_ERROR_CODES = {
  // JSON-RPC 2.0 standard errors
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // MCP custom errors (-32000 to -32099 reserved for implementation)
  AUTHENTICATION_REQUIRED: -32001,
  RATE_LIMIT_EXCEEDED: -32002,
  RESOURCE_NOT_FOUND: -32003,
  PERMISSION_DENIED: -32004,
  TIMEOUT: -32005,
  SERVICE_UNAVAILABLE: -32006,
  VALIDATION_ERROR: -32007,
  CIRCUIT_BREAKER_OPEN: -32008,
} as const

export type McpErrorCode = typeof MCP_ERROR_CODES[keyof typeof MCP_ERROR_CODES]

/**
 * Error code descriptions
 */
export const ERROR_DESCRIPTIONS: Record<McpErrorCode, string> = {
  [MCP_ERROR_CODES.PARSE_ERROR]: 'Invalid JSON was received',
  [MCP_ERROR_CODES.INVALID_REQUEST]: 'The JSON sent is not a valid Request object',
  [MCP_ERROR_CODES.METHOD_NOT_FOUND]: 'The method does not exist / is not available',
  [MCP_ERROR_CODES.INVALID_PARAMS]: 'Invalid method parameter(s)',
  [MCP_ERROR_CODES.INTERNAL_ERROR]: 'Internal server error',
  [MCP_ERROR_CODES.AUTHENTICATION_REQUIRED]: 'Authentication is required',
  [MCP_ERROR_CODES.RATE_LIMIT_EXCEEDED]: 'Rate limit exceeded',
  [MCP_ERROR_CODES.RESOURCE_NOT_FOUND]: 'The requested resource was not found',
  [MCP_ERROR_CODES.PERMISSION_DENIED]: 'Permission denied for this operation',
  [MCP_ERROR_CODES.TIMEOUT]: 'The operation timed out',
  [MCP_ERROR_CODES.SERVICE_UNAVAILABLE]: 'The service is temporarily unavailable',
  [MCP_ERROR_CODES.VALIDATION_ERROR]: 'Input validation failed',
  [MCP_ERROR_CODES.CIRCUIT_BREAKER_OPEN]: 'Service circuit breaker is open',
}

/**
 * MCP Error class
 */
export class McpError extends Error {
  public readonly code: McpErrorCode
  public readonly data?: unknown

  constructor(code: McpErrorCode, message?: string, data?: unknown) {
    super(message || ERROR_DESCRIPTIONS[code])
    this.name = 'McpError'
    this.code = code
    this.data = data
  }

  /**
   * Convert to JSON-RPC error response format
   */
  toJsonRpcError(id: string | number | null = null): {
    jsonrpc: '2.0'
    id: string | number | null
    error: {
      code: McpErrorCode
      message: string
      data?: unknown
    }
  } {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: this.code,
        message: this.message,
        ...(this.data !== undefined && { data: this.data }),
      },
    }
  }
}

/**
 * Create a parse error
 */
export function parseError(details?: string): McpError {
  return new McpError(
    MCP_ERROR_CODES.PARSE_ERROR,
    details || 'Invalid JSON was received',
    details ? { details } : undefined
  )
}

/**
 * Create an invalid request error
 */
export function invalidRequest(details?: string): McpError {
  return new McpError(
    MCP_ERROR_CODES.INVALID_REQUEST,
    details || 'The JSON sent is not a valid Request object',
    details ? { details } : undefined
  )
}

/**
 * Create a method not found error
 */
export function methodNotFound(method: string): McpError {
  return new McpError(
    MCP_ERROR_CODES.METHOD_NOT_FOUND,
    `Method not found: ${method}`,
    { method }
  )
}

/**
 * Create an invalid params error
 */
export function invalidParams(errors: string[]): McpError {
  return new McpError(
    MCP_ERROR_CODES.INVALID_PARAMS,
    errors.length === 1 ? errors[0] : `Invalid parameters: ${errors.join(', ')}`,
    { validationErrors: errors }
  )
}

/**
 * Create an internal error
 */
export function internalError(message?: string, details?: unknown): McpError {
  return new McpError(
    MCP_ERROR_CODES.INTERNAL_ERROR,
    message || 'Internal server error',
    details
  )
}

/**
 * Create an authentication required error
 */
export function authenticationRequired(oauthUrl?: string): McpError {
  return new McpError(
    MCP_ERROR_CODES.AUTHENTICATION_REQUIRED,
    'Authentication required',
    {
      type: 'AUTHENTICATION_REQUIRED',
      ...(oauthUrl && { oauth: oauthUrl }),
      instructions: 'Connect your Minds AI account via OAuth or provide an API key.',
    }
  )
}

/**
 * Create a rate limit exceeded error
 */
export function rateLimitExceeded(retryAfter: number): McpError {
  return new McpError(
    MCP_ERROR_CODES.RATE_LIMIT_EXCEEDED,
    `Rate limit exceeded. Retry after ${retryAfter} seconds.`,
    { retryAfter }
  )
}

/**
 * Create a resource not found error
 */
export function resourceNotFound(resourceType: string, resourceId?: string): McpError {
  return new McpError(
    MCP_ERROR_CODES.RESOURCE_NOT_FOUND,
    resourceId
      ? `${resourceType} not found: ${resourceId}`
      : `${resourceType} not found`,
    { resourceType, resourceId }
  )
}

/**
 * Create a permission denied error
 */
export function permissionDenied(operation?: string): McpError {
  return new McpError(
    MCP_ERROR_CODES.PERMISSION_DENIED,
    operation
      ? `Permission denied for: ${operation}`
      : 'Permission denied',
    operation ? { operation } : undefined
  )
}

/**
 * Create a timeout error
 */
export function timeout(operation?: string, timeoutMs?: number): McpError {
  return new McpError(
    MCP_ERROR_CODES.TIMEOUT,
    operation
      ? `Operation timed out: ${operation}`
      : 'Operation timed out',
    { operation, timeoutMs }
  )
}

/**
 * Create a service unavailable error
 */
export function serviceUnavailable(service?: string): McpError {
  return new McpError(
    MCP_ERROR_CODES.SERVICE_UNAVAILABLE,
    service
      ? `Service unavailable: ${service}`
      : 'Service temporarily unavailable',
    { service }
  )
}

/**
 * Create a validation error
 */
export function validationError(errors: string[]): McpError {
  return new McpError(
    MCP_ERROR_CODES.VALIDATION_ERROR,
    errors.length === 1 ? errors[0] : `Validation failed: ${errors.join(', ')}`,
    { validationErrors: errors }
  )
}

/**
 * Create a circuit breaker open error
 */
export function circuitBreakerOpen(serviceName: string): McpError {
  return new McpError(
    MCP_ERROR_CODES.CIRCUIT_BREAKER_OPEN,
    `Service temporarily unavailable: ${serviceName}`,
    { service: serviceName }
  )
}

/**
 * Convert any error to an McpError
 */
export function toMcpError(error: unknown): McpError {
  if (error instanceof McpError) {
    return error
  }

  if (error instanceof Error) {
    // Check for common error patterns
    const message = error.message.toLowerCase()

    if (message.includes('timeout') || message.includes('timed out')) {
      return timeout(undefined, undefined)
    }

    if (message.includes('not found')) {
      return resourceNotFound('Resource')
    }

    if (message.includes('unauthorized') || message.includes('authentication')) {
      return authenticationRequired()
    }

    if (message.includes('forbidden') || message.includes('permission')) {
      return permissionDenied()
    }

    return internalError(error.message)
  }

  return internalError(String(error))
}

/**
 * Format error response for HTTP
 */
export function formatHttpError(
  error: McpError,
  requestId?: string | number | null
): {
  statusCode: number
  body: ReturnType<McpError['toJsonRpcError']>
  headers: Record<string, string>
} {
  // Map MCP error codes to HTTP status codes
  let statusCode: number
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  switch (error.code) {
    case MCP_ERROR_CODES.PARSE_ERROR:
    case MCP_ERROR_CODES.INVALID_REQUEST:
    case MCP_ERROR_CODES.INVALID_PARAMS:
    case MCP_ERROR_CODES.VALIDATION_ERROR:
      statusCode = 400
      break
    case MCP_ERROR_CODES.AUTHENTICATION_REQUIRED:
      statusCode = 401
      break
    case MCP_ERROR_CODES.PERMISSION_DENIED:
      statusCode = 403
      break
    case MCP_ERROR_CODES.METHOD_NOT_FOUND:
    case MCP_ERROR_CODES.RESOURCE_NOT_FOUND:
      statusCode = 404
      break
    case MCP_ERROR_CODES.RATE_LIMIT_EXCEEDED:
      statusCode = 429
      if (error.data && typeof error.data === 'object' && 'retryAfter' in error.data) {
        headers['Retry-After'] = String(error.data.retryAfter)
      }
      break
    case MCP_ERROR_CODES.TIMEOUT:
      statusCode = 504
      break
    case MCP_ERROR_CODES.SERVICE_UNAVAILABLE:
    case MCP_ERROR_CODES.CIRCUIT_BREAKER_OPEN:
      statusCode = 503
      break
    default:
      statusCode = 500
  }

  return {
    statusCode,
    body: error.toJsonRpcError(requestId ?? null),
    headers,
  }
}
