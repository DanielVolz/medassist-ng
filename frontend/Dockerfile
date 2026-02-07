# =============================================================================
# FRONTEND DOCKERFILE - Security Hardened
# =============================================================================
# Security measures applied:
# - Non-root user execution (nginx user)
# - Multi-stage build (minimal runtime)
# - Read-only filesystem compatible
# - No unnecessary packages
# - Specific image versions pinned
# - Unprivileged nginx configuration
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
COPY tsconfig.json tsconfig.node.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: Production Runtime (nginx unprivileged)
# -----------------------------------------------------------------------------
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runner

# Copy custom nginx config as template
# nginx-unprivileged automatically processes .template files with envsubst
COPY nginx.conf /etc/nginx/templates/default.conf.template

# Copy built static files with correct ownership (nginx user = uid 101)
COPY --from=builder --chown=101:101 /app/dist /usr/share/nginx/html

# nginx-unprivileged listens on 8080 by default
EXPOSE 8080

# Already runs as non-root (nginx user, uid 101)
USER nginx

# Start nginx (entrypoint automatically processes templates)
CMD ["nginx", "-g", "daemon off;"]
