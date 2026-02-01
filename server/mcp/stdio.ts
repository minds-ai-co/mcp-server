#!/usr/bin/env node
/**
 * Minds AI MCP Server - stdio transport
 *
 * For use with Claude Desktop, Cursor, and other MCP clients that use stdio transport.
 *
 * Environment variables:
 *   MINDSAI_API_KEY - Your Minds AI API key (required)
 *
 * Usage with Claude Desktop (claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "mindsai": {
 *       "command": "npx",
 *       "args": ["tsx", "/path/to/webapp/server/mcp/stdio.ts"],
 *       "env": {
 *         "MINDSAI_API_KEY": "aox_your_api_key_here"
 *       }
 *     }
 *   }
 * }
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createStdioServer } from './stdioServer'

const API_URL = 'https://getminds.ai'

async function main() {
  const apiKey = process.env.MINDSAI_API_KEY

  if (!apiKey) {
    console.error('Error: MINDSAI_API_KEY environment variable is required')
    console.error('')
    console.error('Get your API key from https://getminds.ai/settings/api-keys')
    console.error('')
    console.error('Usage:')
    console.error('  MINDSAI_API_KEY=aox_xxx npx tsx server/mcp/stdio.ts')
    process.exit(1)
  }

  // Create server
  const server = createStdioServer(API_URL, apiKey)

  // Create stdio transport
  const transport = new StdioServerTransport()

  // Connect and run
  await server.connect(transport)

  // Log to stderr (stdout is reserved for MCP protocol)
  console.error('[MCP] Minds AI server started')
  console.error('[MCP] Waiting for requests...')
}

main().catch((error) => {
  console.error('[MCP] Fatal error:', error)
  process.exit(1)
})
