FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS build
COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/worker apps/worker
COPY packages packages
COPY prisma prisma
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter './packages/**' build && pnpm --filter @mint-copilot/worker build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
CMD ["node", "apps/worker/dist/main.js"]
