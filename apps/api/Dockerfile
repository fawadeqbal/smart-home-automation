# Build context: the repository root (see infra/docker-compose.yml)
FROM node:22-alpine AS build
RUN apk add --no-cache openssl && corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @home/api...
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN pnpm --filter @home/contracts build && pnpm --filter @home/api build \
 && pnpm --filter @home/api deploy --legacy --prod /out \
 && cd /out && npx prisma generate

FROM node:22-alpine
RUN apk add --no-cache openssl postgresql16-client
WORKDIR /app
COPY --from=build /out ./
ENV NODE_ENV=production API_PORT=4000
EXPOSE 4000
# Apply database migrations, then start
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
