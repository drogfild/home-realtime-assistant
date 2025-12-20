FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY pnpm-lock.yaml ./pnpm-lock.yaml || true
COPY apps ./apps
COPY packages ./packages
RUN corepack enable && pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @home/web... build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/apps/web/dist ./dist
RUN npm install -g serve
CMD ["serve", "-s", "dist", "-l", "4173"]
EXPOSE 4173
