# Deployment

## Required Services

- Supabase Postgres
- Supabase Auth
- Redis
- Node.js runtime for API and worker
- Next.js hosting for web
- RPC providers for Base and Ethereum

## Environment

Copy `.env.example` to `.env` and fill all required values. Use a 32-byte base64 value for `ENCRYPTION_MASTER_KEY`.

## Database

```bash
pnpm prisma:generate
pnpm prisma:migrate
```

## Docker

```bash
docker compose up --build
```

Nginx listens on `http://localhost:8080` and routes web, API, and Socket.IO traffic.

## Cloudflare

Place Cloudflare in front of Nginx or the platform load balancer. Enable WebSocket support, TLS, WAF managed rules, bot fight mode only where it does not interfere with legitimate user sessions, and cache only static Next.js assets.
