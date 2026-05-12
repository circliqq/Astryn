FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages packages
COPY prisma prisma
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY . .
RUN pnpm --filter './packages/**' build && pnpm --filter @mint-copilot/web build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
CMD ["pnpm", "--filter", "@mint-copilot/web", "start"]
