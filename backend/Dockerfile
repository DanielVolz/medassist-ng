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

# Install dependencies first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Remove dev dependencies for smaller image
RUN npm ci --omit=dev --ignore-scripts && \
    npm cache clean --force

# -----------------------------------------------------------------------------
# Stage 2: Production Runtime
# -----------------------------------------------------------------------------
FROM node:22-slim AS runner

WORKDIR /app

# Create non-root user with specific UID for consistent bind mount permissions
RUN groupadd --gid 1000 appgroup && \
    useradd --uid 1000 --gid appgroup --shell /bin/sh --create-home appuser

# Copy built application
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Create data directory and set ownership
RUN mkdir -p /app/data && chown -R appuser:appgroup /app

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Environment configuration
ENV NODE_ENV=production
ENV PORT=3000

# Expose application port
EXPOSE 3000

# Entrypoint runs as root to fix permissions, then drops to appuser
ENTRYPOINT ["/docker-entrypoint.sh"]

# Start application
CMD ["node", "dist/index.js"]
