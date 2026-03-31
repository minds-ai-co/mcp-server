# Minds AI MCP Server
# For deployment to Dedalus Labs marketplace
#
# Build:
#   docker build -t mindsai-mcp .
#
# Run:
#   docker run -p 3001:3001 mindsai-mcp

FROM node:22-alpine

WORKDIR /app

# Enable pnpm via corepack and install tsx globally
RUN corepack enable && corepack prepare pnpm@latest --activate && \
    pnpm install -g tsx

# Copy package.json and install deps
COPY package.json ./
RUN pnpm install --prod

# Copy MCP server source files
COPY server/mcp ./server/mcp

# Environment
ENV NODE_ENV=production
ENV PORT=3001

# Expose HTTP port
EXPOSE 3001

# Use HTTP transport for cloud deployment
CMD ["tsx", "server/mcp/main.ts"]
