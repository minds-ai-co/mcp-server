#!/usr/bin/env node
/**
 * Minds AI MCP Server - HTTP Entry Point
 *
 * For cloud deployment on Dedalus Labs.
 * Uses StreamableHTTPServerTransport with session management.
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createArtOfXServer } from './server'

const API_URL = 'https://getminds.ai'
const PORT = parseInt(process.env.PORT || '3001', 10)
const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost'

// Session storage
interface Session {
  transport: StreamableHTTPServerTransport
  apiKey: string
}
const sessions = new Map<string, Session>()

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
 * Create a new MCP session
 */
async function createSession(apiKey: string): Promise<{ sessionId: string; transport: StreamableHTTPServerTransport }> {
  const sessionId = randomUUID()

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => sessionId,
  })

  // Create and connect server
  const server = createArtOfXServer(API_URL, apiKey)
  await server.connect(transport)

  // Store session
  sessions.set(sessionId, { transport, apiKey })

  // Clean up on close
  transport.onclose = () => {
    sessions.delete(sessionId)
    console.log(`[MCP] Session closed: ${sessionId.slice(0, 8)}...`)
  }

  console.log(`[MCP] New session: ${sessionId.slice(0, 8)}...`)
  return { sessionId, transport }
}

/**
 * Handle MCP requests
 */
async function handleMcpRequest(req: IncomingMessage, res: ServerResponse) {
  const sessionId = req.headers['mcp-session-id'] as string | undefined
  const authHeader = req.headers['authorization'] as string | undefined
  const apiKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : ''

  try {
    // Check for existing session
    if (sessionId) {
      const session = sessions.get(sessionId)
      if (session) {
        await session.transport.handleRequest(req, res)
        return
      }
      // Session not found
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Session not found' }))
      return
    }

    // Create new session for POST requests
    if (req.method === 'POST') {
      const { transport } = await createSession(apiKey)
      await transport.handleRequest(req, res)
      return
    }

    // No session and not POST
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Session required. Send POST to create session.' }))
  } catch (error) {
    console.error('[MCP] Error handling request:', error)
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Internal server error' }))
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
    res.end(JSON.stringify({ status: 'ok', server: 'mindsai-mcp', sessions: sessions.size }))
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

  // MCP endpoint
  if (url.pathname === '/mcp') {
    await handleMcpRequest(req, res)
    return
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
