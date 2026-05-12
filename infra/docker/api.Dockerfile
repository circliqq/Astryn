FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages packages
COPY prisma prisma
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY . .
RUN pnpm --filter ...@mint-copilot/api build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
CMD ["node", "apps/api/dist/main.js"]
