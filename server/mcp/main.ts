#!/usr/bin/env node
/**
 * Minds AI MCP Server - HTTP Entry Point
 *
 * For cloud deployment on Dedalus Labs.
 * Session-based HTTP transport - maintains server instances across requests.
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createArtOfXServer } from './server'

const API_URL = 'https://getminds.ai'
const PORT = parseInt(process.env.PORT || '3001', 10)
const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost'

// Session storage for maintaining state across requests
interface Session {
  transport: StreamableHTTPServerTransport
  server: McpServer
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
 * Handle MCP requests with session management
 * - First POST creates a new session (initialize)
 * - Subsequent requests reuse the session via mcp-session-id header
 */
async function handleMcpRequest(req: IncomingMessage, res: ServerResponse) {
  const sessionId = req.headers['mcp-session-id'] as string | undefined
  const authHeader = req.headers['authorization'] as string | undefined
  const apiKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : ''

  try {
    // Existing session - reuse it
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!
      await session.transport.handleRequest(req, res)
      return
    }

    // New session (POST without session ID or with unknown session ID)
    if (req.method === 'POST') {
      const newSessionId = randomUUID()
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
      })

      const server = createArtOfXServer(API_URL, apiKey)
      await server.connect(transport)

      sessions.set(newSessionId, { transport, server })
      console.log(`[MCP] Created session: ${newSessionId}`)

      // Clean up session when transport closes
      transport.onclose = () => {
        sessions.delete(newSessionId)
        console.log(`[MCP] Closed session: ${newSessionId}`)
      }

      await transport.handleRequest(req, res)
      return
    }

    // DELETE request to close session
    if (req.method === 'DELETE' && sessionId) {
      const session = sessions.get(sessionId)
      if (session) {
        await session.transport.close()
        sessions.delete(sessionId)
        console.log(`[MCP] Deleted session: ${sessionId}`)
        res.writeHead(200)
        res.end()
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Session not found' }))
      }
      return
    }
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

  // MCP endpoint - handle GET, POST, and DELETE
  if (url.pathname === '/mcp') {
    if (req.method === 'POST' || req.method === 'DELETE') {
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
