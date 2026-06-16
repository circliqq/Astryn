FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS build
COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api apps/api
COPY packages packages
COPY prisma prisma
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter './packages/**' build && pnpm --filter @mint-copilot/api build

FROM base AS runner
ENV NODE_ENV=production

# Install Python + pip + eligibility worker dependencies
RUN apk add --no-cache python3 py3-pip py3-setuptools
COPY tools/requirements.txt /tools/requirements.txt
RUN pip3 install --break-system-packages -r /tools/requirements.txt

# Copy Python worker
COPY tools/eligibility_worker.py /tools/eligibility_worker.py

COPY --from=build /app /app
ENV PYTHON_CMD=python3
ENV ELIGIBILITY_WORKER_PATH=/tools/eligibility_worker.py
CMD ["node", "apps/api/dist/main.js"]
