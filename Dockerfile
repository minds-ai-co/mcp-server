# Minds AI MCP Server
# For deployment to Dedalus Labs marketplace
#
# Build:
#   docker build -t mindsai-mcp .
#
# Run:
#   docker run -e MINDSAI_API_KEY=aox_xxx mindsai-mcp

FROM node:22-alpine

WORKDIR /app

# Install tsx globally for running TypeScript
RUN npm install -g tsx

# Copy package.json and install deps
COPY package.json ./
RUN npm install --production

# Copy MCP server source files
COPY server/mcp ./server/mcp

# Environment
ENV NODE_ENV=production

# The MCP server uses stdio transport
# MINDSAI_API_KEY must be provided at runtime
ENTRYPOINT ["tsx", "server/mcp/stdio.ts"]
