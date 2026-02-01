#!/usr/bin/env node
/**
 * Minds AI MCP Server - HTTP transport
 *
 * For cloud deployment on Dedalus Labs and other HTTP-based MCP hosts.
 *
 * Environment variables:
 *   MINDSAI_API_KEY - Default API key (optional, users provide their own via auth)
 *   PORT - Server port (default: 3001)
 */

import { createServer } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createArtOfXServer } from './server'

const PORT = parseInt(process.env.PORT || '3001', 10)
const API_URL = 'https://getminds.ai'

// Create HTTP server
const httpServer = createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, mcp-session-id')
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id')

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  // Health check
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', server: 'mindsai-mcp' }))
    return
  }

  // MCP endpoint
  if (req.url === '/mcp' || req.url?.startsWith('/mcp?')) {
    try {
      // Extract auth token from header
      const authHeader = req.headers.authorization
      const apiKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : ''

      // Create MCP server with auth
      const mcpServer = createArtOfXServer(API_URL, apiKey)

      // Create transport for this request
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
      })

      // Connect server to transport
      await mcpServer.connect(transport)

      // Handle the request
      await transport.handleRequest(req, res)
    } catch (error) {
      console.error('[MCP] Error handling request:', error)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Internal server error' }))
      }
    }
    return
  }

  // 404 for other routes
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

httpServer.listen(PORT, () => {
  console.log(`[MCP] Minds AI server listening on port ${PORT}`)
  console.log(`[MCP] MCP endpoint: http://localhost:${PORT}/mcp`)
})
