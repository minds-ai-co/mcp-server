#!/usr/bin/env node
/**
 * Minds AI MCP Server - HTTP Entry Point
 *
 * For cloud deployment on Dedalus Labs.
 * Stateless HTTP transport - each request creates a new server instance.
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createArtOfXServer } from './server'

const API_URL = 'https://getminds.ai'
const PORT = parseInt(process.env.PORT || '3001', 10)
const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost'

/**
 * Set CORS headers
 */
function setCorsHeaders(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, mcp-session-id')
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id')
}

/**
 * Handle MCP requests - stateless, creates new server per request
 */
async function handleMcpRequest(req: IncomingMessage, res: ServerResponse) {
  const authHeader = req.headers['authorization'] as string | undefined
  const apiKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : ''

  try {
    // Create transport for this request
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    })

    // Create and connect server
    const server = createArtOfXServer(API_URL, apiKey)
    await server.connect(transport)

    // Handle the request
    await transport.handleRequest(req, res)
  } catch (error) {
    console.error('[MCP] Error handling request:', error)
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null
      }))
    }
  }
}

/**
 * Request handler
 */
async function requestHandler(req: IncomingMessage, res: ServerResponse) {
  setCorsHeaders(res)

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`)

  // Health check
  if (url.pathname === '/health' || url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', server: 'mindsai-mcp' }))
    return
  }

  // OAuth Protected Resource Metadata (RFC 9728)
  if (url.pathname === '/.well-known/oauth-protected-resource') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      resource: `${API_URL}/mcp`,
      authorization_servers: [`${API_URL}`],
      scopes_supported: ['sparks:read', 'sparks:write', 'sparks:chat'],
      bearer_methods_supported: ['header'],
      resource_documentation: 'https://getminds.ai/docs/mcp',
    }))
    return
  }

  // MCP endpoint - handle both GET and POST
  if (url.pathname === '/mcp') {
    if (req.method === 'POST') {
      await handleMcpRequest(req, res)
      return
    }
    // GET returns server info
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        name: 'mindsai-personas',
        version: '1.0.0',
        description: 'Create AI personas, digital twins, and expert advisors.',
        protocol: 'mcp',
        transport: 'http',
      }))
      return
    }
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
}

// Start server
const server = createServer(requestHandler)

server.listen(PORT, HOST, () => {
  console.log(`[MCP] Minds AI server listening on http://${HOST}:${PORT}`)
  console.log(`[MCP] MCP endpoint: http://${HOST}:${PORT}/mcp`)
  console.log(`[MCP] Health check: http://${HOST}:${PORT}/health`)
})
