# syntax=docker/dockerfile:1.7
# Multi-stage build: compile TS -> run as plain Node
ARG NODE_VERSION=20-alpine

FROM node:${NODE_VERSION} AS builder
WORKDIR /app

# Install deps with caching
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# Prune devDependencies for the runtime image
RUN --mount=type=cache,target=/root/.npm \
    npm prune --omit=dev

FROM node:${NODE_VERSION} AS runtime
LABEL org.opencontainers.image.title="aion" \
      org.opencontainers.image.description="Project gateway for code-aware AI agents" \
      org.opencontainers.image.source="https://github.com/aionlabs/aion" \
      org.opencontainers.image.licenses="MIT"

# Run as non-root user
RUN addgroup -S aion && adduser -S aion -G aion
USER aion
WORKDIR /home/aion

COPY --from=builder --chown=aion:aion /app/node_modules ./node_modules
COPY --from=builder --chown=aion:aion /app/dist ./dist
COPY --from=builder --chown=aion:aion /app/package.json ./package.json

ENV NODE_ENV=production \
    AION_HOME=/home/aion/.aion

# Default to MCP server (the headline use case)
ENTRYPOINT ["node", "dist/index.js"]
CMD ["mcp", "serve"]

# Health check: aion doctor --json (exits 0 if PIL + provider healthy)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node dist/index.js doctor --json || exit 1