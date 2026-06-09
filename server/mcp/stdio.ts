#!/usr/bin/env node
import { logger } from '../utils/logger'

const serviceLogger = logger.withTag('MCP')

/**
 * Minds MCP Server - stdio transport
 *
 * For use with Claude Desktop, Cursor, and other MCP clients that use stdio transport.
 *
 * Environment variables:
 *   MINDSAI_API_KEY - Your Minds API key (required)
 *
 * Usage with Claude Desktop (claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "mindsai": {
 *       "command": "npx",
 *       "args": ["tsx", "/path/to/webapp/server/mcp/stdio.ts"],
 *       "env": {
 *         "MINDSAI_API_KEY": "minds_your_api_key_here"
 *       }
 *     }
 *   }
 * }
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMindsServer } from './server'

const API_URL = process.env.MINDSAI_API_URL || 'https://getminds.ai'

async function main() {
  const apiKey = process.env.MINDSAI_API_KEY

  if (!apiKey) {
    serviceLogger.error('Error: MINDSAI_API_KEY environment variable is required')
    serviceLogger.error('')
    serviceLogger.error('Get your API key from https://getminds.ai/settings/api-keys')
    serviceLogger.error('')
    serviceLogger.error('Usage:')
    serviceLogger.error('  MINDSAI_API_KEY=minds_xxx npx tsx server/mcp/stdio.ts')
    process.exit(1)
  }

  // Create server
  const server = createMindsServer({ publicBaseUrl: API_URL, authToken: apiKey, apiBaseUrl: API_URL, useExtApps: false })

  // Create stdio transport
  const transport = new StdioServerTransport()

  // Connect and run
  await server.connect(transport)

  // Log to stderr (stdout is reserved for MCP protocol)
  serviceLogger.error('Minds server started')
  serviceLogger.error('Waiting for requests...')
}

main().catch((error) => {
  serviceLogger.error('Fatal error:', error)
  process.exit(1)
})
