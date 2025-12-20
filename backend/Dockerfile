# Backend build
FROM node:25-slim AS builder
WORKDIR /app
COPY package.json tsconfig.json ./
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
EXPOSE 3000
# Run database setup before starting the server
CMD ["sh", "-c", "mkdir -p /app/data && node dist/db/migrate.js && node dist/index.js"]
