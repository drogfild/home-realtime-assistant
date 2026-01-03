FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY pnpm-lock.yaml ./pnpm-lock.yaml
COPY apps ./apps
COPY packages ./packages
RUN corepack enable && pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @home/tool-gateway... build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/apps/tool-gateway/dist ./dist
COPY --from=builder /app/apps/tool-gateway/package.json ./package.json
CMD ["node", "dist/index.js"]
EXPOSE 4001
