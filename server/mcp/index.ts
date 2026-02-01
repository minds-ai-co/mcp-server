/**
 * Minds AI MCP Server - Entry Point
 *
 * This is the main entry point for the MCP server module.
 * It re-exports the server factory and utilities needed by other parts of the application.
 */

// Main server factory
export { createArtOfXServer, type ArtOfXServer } from './server'

// Utilities (for use by API endpoints)
export { verifyUserDiscoveryToken, generateUserDiscoveryToken } from './utils/tokens'
export { pendingWidgetTokens } from './utils/cache'

// Types
export * from './types'
