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
COPY package.json .
# Create data directory for runtime (will be mounted as volume)
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
