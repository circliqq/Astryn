# Astryn

Astryn is a production-grade NFT mint automation and monitoring platform for OpenSea Drops on Base and Ethereum.

It combines a secure wallet vault, OpenSea drop scanning, eligibility and wallet health checks, simulation-first execution, gas protection, RPC pool monitoring, live task logs, and post-mint reporting.

## Apps

- `apps/web` - Next.js App Router dashboard
- `apps/api` - NestJS API, Socket.IO gateway, Supabase Auth integration
- `apps/worker` - BullMQ execution engine for mint, RPC health, funding, and reports

## Packages

- `packages/wallet-crypto` - Argon2id + AES-256-GCM wallet encryption
- `packages/blockchain` - viem blockchain operations
- `packages/opensea` - backend-only OpenSea Drops integration
- `packages/rpc-pool` - RPC health, rotation, and parallel broadcast
- `packages/gas-engine` - gas caps, cost estimation, bump policy, gas guardian
- `packages/shared` - shared schemas, types, errors, readiness scoring
- `packages/logger` - structured logging

## Quick Start

```bash
pnpm install
cp .env.example .env
pnpm prisma:generate
pnpm dev
```

For a production-like local stack:

```bash
docker compose up --build
```

See `docs/deployment.md` and `docs/security.md` before handling real wallets or mainnet transactions.
