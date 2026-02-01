/**
 * Token utilities for MCP server
 * Handles user discovery token generation and verification
 */

import { createHmac, randomBytes } from 'crypto'

/**
 * Get the discovery secret, failing loudly if not configured in production
 */
function getDiscoverySecret(): string {
  const secret = process.env.MCP_DISCOVERY_SECRET

  if (!secret) {
    const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === undefined
    if (isDev) {
      // In development, generate a random secret per process (still secure, just not persistent)
      console.warn('[MCP Tokens] WARNING: MCP_DISCOVERY_SECRET not set. Using random secret (tokens will not persist across restarts)')
      return randomBytes(32).toString('hex')
    }
    throw new Error('MCP_DISCOVERY_SECRET environment variable is required in production')
  }

  // Validate secret strength
  if (secret.length < 32) {
    throw new Error('MCP_DISCOVERY_SECRET must be at least 32 characters long')
  }

  return secret
}

// Cache the secret after first access
let cachedSecret: string | null = null
function getSecret(): string {
  if (!cachedSecret) {
    cachedSecret = getDiscoverySecret()
  }
  return cachedSecret
}

/**
 * Generate a signed user discovery token
 * This allows the widget to discover sparks for this user only
 *
 * Token format: base64url(userId:signature)
 * - No expiry (safe because token only allows reading user's own sparks)
 * - HMAC-SHA256 signed with 128-bit signature (32 hex chars)
 * - User already authenticated via OAuth
 */
export function generateUserDiscoveryToken(userId: string): string {
  const payload = userId
  const signature = createHmac('sha256', getSecret())
    .update(payload)
    .digest('hex')
    .slice(0, 32) // 128 bits (32 hex chars) - cryptographically secure
  return Buffer.from(`${payload}:${signature}`).toString('base64url')
}

/**
 * Verify a user discovery token and extract the userId
 * Supports multiple token formats for backwards compatibility:
 * - Old format with expiry (16 char sig): userId:expiry:signature
 * - Old format without expiry (16 char sig): userId:signature
 * - New format (32 char sig): userId:signature
 *
 * @returns userId if valid, null if invalid/expired
 */
export function verifyUserDiscoveryToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString()
    const parts = decoded.split(':')

    let userId: string
    let signature: string

    if (parts.length === 3) {
      // Old format with expiry - check expiry for backwards compatibility
      const [uid, expiryStr, sig] = parts
      const expiry = parseInt(expiryStr, 10)
      if (Date.now() > expiry) return null // Expired
      userId = uid
      signature = sig
      const expectedPayload = `${userId}:${expiryStr}`
      const expectedSignature = createHmac('sha256', getSecret())
        .update(expectedPayload)
        .digest('hex')
        .slice(0, 16) // Old format used 16 char signatures
      if (signature !== expectedSignature) return null
    } else if (parts.length === 2) {
      // Format without expiry - check signature length to determine version
      [userId, signature] = parts

      // Determine signature length (old: 16 chars, new: 32 chars)
      const sigLength = signature.length <= 16 ? 16 : 32

      const expectedSignature = createHmac('sha256', getSecret())
        .update(userId)
        .digest('hex')
        .slice(0, sigLength)

      if (signature !== expectedSignature) return null
    } else {
      return null // Invalid format
    }

    return userId
  } catch {
    return null
  }
}
