# Backend build
FROM node:25-slim AS builder
WORKDIR /app
COPY package.json tsconfig.json drizzle.config.ts ./
COPY src ./src
RUN npm install
RUN npm run build
RUN npm prune --omit=dev

# Runtime
FROM node:25-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# Copy migration SQL files (needed for runtime migrations)
COPY --from=builder /app/src/db/migrations ./dist/db/migrations
COPY package.json .
EXPOSE 3000
# Run migrations before starting the server
CMD ["sh", "-c", "mkdir -p /app/data && node dist/db/migrate.js && node dist/index.js"]
