# =============================================================================
# BACKEND DOCKERFILE - Security Hardened
# =============================================================================
# Security measures applied:
# - Non-root user execution
# - Multi-stage build (minimal runtime image)
# - No shell in final image (distroless)
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
# Stage 2: Production Runtime (Distroless - no shell, minimal attack surface)
# -----------------------------------------------------------------------------
FROM gcr.io/distroless/nodejs22-debian12 AS runner

WORKDIR /app

# Copy built application with correct ownership (nonroot = uid 65532)
COPY --from=builder --chown=65532:65532 /app/node_modules ./node_modules
COPY --from=builder --chown=65532:65532 /app/dist ./dist
COPY --from=builder --chown=65532:65532 /app/package.json ./

# Environment configuration
ENV NODE_ENV=production
ENV PORT=3000

# Expose application port
EXPOSE 3000

# Run as non-root user (distroless default user)
USER nonroot

# Start application - migrations handled in index.ts
CMD ["dist/index.js"]
