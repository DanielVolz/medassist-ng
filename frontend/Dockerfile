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

COPY shared/package.json shared/package-lock.json* ./shared/
RUN cd shared && npm ci --ignore-scripts

COPY shared/tsconfig.json ./shared/
COPY shared/src ./shared/src
RUN cd shared && npm run build

# Install dependencies first (better layer caching)
COPY frontend/package.json frontend/package-lock.json* ./frontend/
WORKDIR /app/frontend
RUN npm ci --ignore-scripts

# Copy source and build
COPY frontend/tsconfig.json frontend/tsconfig.node.json frontend/vite.config.ts frontend/index.html ./
COPY frontend/src ./src
COPY frontend/public ./public
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: Production Runtime (nginx unprivileged)
# -----------------------------------------------------------------------------
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runner

# Redirect envsubst output to /tmp (writable under read_only: true)
# and update nginx main config to include from there instead of /etc/nginx/conf.d/
ENV NGINX_ENVSUBST_OUTPUT_DIR=/tmp
RUN sed -i 's|include /etc/nginx/conf.d/\*.conf;|include /tmp/default.conf;|' /etc/nginx/nginx.conf

# Copy custom nginx config as template for envsubst processing
# nginx-unprivileged automatically substitutes env vars in .template files
COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template

# Copy entrypoint wrapper (translates LOG_LEVEL → nginx access log control)
COPY --chmod=755 frontend/nginx-entrypoint.sh /nginx-entrypoint.sh

# Copy built static files with correct ownership (nginx user = uid 101)
COPY --from=builder --chown=101:101 /app/frontend/dist /usr/share/nginx/html

# nginx-unprivileged listens on 8080 by default
EXPOSE 8080

# Already runs as non-root (nginx user, uid 101)
USER nginx

# Use wrapper entrypoint that maps LOG_LEVEL to nginx config
ENTRYPOINT ["/nginx-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
