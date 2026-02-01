/**
 * Minds AI MCP Server - Serverless Entry Point
 *
 * For cloud deployment on Dedalus Labs (Lambda/serverless).
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createArtOfXServer } from './server'

const API_URL = 'https://getminds.ai'

/**
 * Serverless handler for MCP requests
 */
export async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, mcp-session-id',
    'Access-Control-Expose-Headers': 'mcp-session-id',
  }

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  // Health check
  if (url.pathname === '/health' || url.pathname === '/') {
    return new Response(
      JSON.stringify({ status: 'ok', server: 'mindsai-mcp' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  // MCP endpoint
  if (url.pathname === '/mcp') {
    try {
      // Extract auth token from header
      const authHeader = req.headers.get('authorization')
      const apiKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : ''

      // Create MCP server with auth
      const mcpServer = createArtOfXServer(API_URL, apiKey)

      // Create transport
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
      })

      // Connect server to transport
      await mcpServer.connect(transport)

      // Handle the request using transport
      // The transport expects Node.js http request/response objects
      // We need to adapt the Web Request to that format
      const body = await req.text()

      // Collect response data
      let responseStatus = 200
      const responseHeaders: Record<string, string> = { ...corsHeaders }
      const responseChunks: string[] = []

      // Create mock Node.js response
      const mockRes = {
        statusCode: 200,
        writeHead(status: number, headers?: Record<string, string>) {
          responseStatus = status
          if (headers) Object.assign(responseHeaders, headers)
          return this
        },
        setHeader(name: string, value: string) {
          responseHeaders[name] = value
          return this
        },
        write(chunk: string | Buffer) {
          responseChunks.push(typeof chunk === 'string' ? chunk : chunk.toString())
          return true
        },
        end(chunk?: string | Buffer) {
          if (chunk) {
            responseChunks.push(typeof chunk === 'string' ? chunk : chunk.toString())
          }
        },
        headersSent: false,
      }

      // Create mock Node.js request
      const mockReq = {
        method: req.method,
        url: url.pathname + url.search,
        headers: Object.fromEntries(req.headers.entries()),
        on(event: string, callback: (data?: any) => void) {
          if (event === 'data' && body) {
            callback(body)
          }
          if (event === 'end') {
            callback()
          }
          return this
        },
      }

      await transport.handleRequest(mockReq as any, mockRes as any)

      return new Response(responseChunks.join(''), {
        status: responseStatus,
        headers: responseHeaders,
      })
    } catch (error) {
      console.error('[MCP] Error handling request:', error)
      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  }

  // 404 for other routes
  return new Response(
    JSON.stringify({ error: 'Not found' }),
    { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  )
}

// Export for various serverless platforms
export default {
  fetch: handler,
}

// Start server if run directly
const port = parseInt(Bun?.env?.PORT || process.env.PORT || '3001', 10)

// Bun server
if (typeof Bun !== 'undefined') {
  Bun.serve({
    port,
    fetch: handler,
  })
  console.log(`[MCP] Minds AI server listening on port ${port}`)
  console.log(`[MCP] MCP endpoint: http://localhost:${port}/mcp`)
}
