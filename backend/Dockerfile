# =============================================================================
# BACKEND DOCKERFILE - Security Hardened
# =============================================================================
# Security measures applied:
# - Non-root user execution
# - Multi-stage build (minimal runtime image)
# - Read-only filesystem compatible
# - No unnecessary packages
# - Specific image versions pinned
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Builder
# -----------------------------------------------------------------------------
FROM node:22-slim AS builder

WORKDIR /app

COPY shared/package.json shared/package-lock.json* ./shared/
RUN cd shared && npm ci --ignore-scripts

COPY shared/tsconfig.json ./shared/
COPY shared/src ./shared/src
RUN cd shared && npm run build

# Install dependencies first (better layer caching)
COPY backend/package.json backend/package-lock.json* ./backend/
WORKDIR /app/backend
RUN npm ci --ignore-scripts

# Copy source and build
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# Remove dev dependencies for smaller image
RUN npm ci --omit=dev --ignore-scripts && \
    npm cache clean --force

# -----------------------------------------------------------------------------
# Stage 2: Production Runtime
# -----------------------------------------------------------------------------
FROM node:22-slim AS runner

WORKDIR /app

# Install gosu for reliable privilege dropping
RUN apt-get update && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/* \
    && gosu nobody true

# Copy built application
COPY --from=builder /app/backend/node_modules ./node_modules
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/package.json ./
COPY --from=builder /app/shared/package.json /shared/package.json
COPY --from=builder /app/shared/dist /shared/dist

# Copy drizzle migrations folder (required for database setup)
COPY backend/drizzle ./drizzle

# Create data directory and set ownership to node user (UID 1000)
RUN mkdir -p /app/data && chown -R node:node /app

# Copy entrypoint script
COPY backend/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Environment configuration
ENV NODE_ENV=production
ENV PORT=3000

# Expose application port
EXPOSE 3000

# Entrypoint runs as root to fix permissions, then drops to node user
ENTRYPOINT ["/docker-entrypoint.sh"]

# Start application
CMD ["node", "dist/index.js"]
