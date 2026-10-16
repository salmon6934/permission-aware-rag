# =============================================================================
# Production Multi-Stage Dockerfile: Permission-Aware Multi-Tenant RAG
# =============================================================================

# --- Stage 1: Builder ---
FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci

# Copy configuration and source files
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript to JavaScript
RUN npm run build

# --- Stage 2: Runtime Runner ---
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install production-only dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled JavaScript from builder
COPY --from=builder /app/dist ./dist

# Copy migration SQL assets so migrations can be executed in production
COPY src/db/migrations ./dist/db/migrations
COPY src/db/migrations ./src/db/migrations

# Set proper ownership to non-root node user
RUN chown -R node:node /app

# Switch to non-root user for security hardening
USER node

EXPOSE 3000

# Container healthcheck probe against Fastify /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server.js"]
