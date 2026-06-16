FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS build
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY
COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web apps/web
COPY packages packages
COPY prisma prisma
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter './packages/**' build && pnpm --filter @mint-copilot/web build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
CMD ["pnpm", "--filter", "@mint-copilot/web", "start"]
