# GasWarMode — Security Audit Report
**Date:** 2026-06-24  
**Scope:** Full codebase review — `apps/api`, `apps/web`, `apps/worker`, `packages/*`, `infra/`, `prisma/`, root config files  
**Auditor:** Claude (AI-assisted static analysis)

---

## Executive Summary

GasWarMode is a crypto NFT minting bot with a NestJS API, Next.js frontend, and background worker. The codebase has solid fundamentals — Supabase JWT auth, Argon2id+AES-256-GCM wallet encryption, proper Prisma parameterized queries, pino log redaction, and admin RBAC. However, **several critical issues exist that must be resolved before production deployment**, most critically a live private key committed in the `.env` file and a WebSocket data leak that exposes all users' events to all connected clients.

---

## Findings

### CRITICAL

---

#### C-1 · Live Private Key in `.env`
**File:** `.env` line 35  
**Risk:** Total compromise of the Flashbots signing identity and any funds held by that address.

```
ETH_FLASHBOTS_AUTH_KEY=0xc099652a0097dde11a8b6890fb00054f8f1a514efc73829f2ee171565197aa51
```

This is a real Ethereum private key. If this file has ever been committed to git — even once — it is permanently exposed in git history.

**Fix:**
1. Rotate the key immediately. Generate a new one and replace in all environments.
2. Check git history: `git log --all --oneline -- .env` and `git grep ETH_FLASHBOTS_AUTH_KEY` to confirm whether it was ever committed.
3. If committed, treat the key as burned regardless of whether the repo is private.

---

#### C-2 · Production Database Password in `.env`
**File:** `.env` lines 1–2  
**Risk:** Full database access (read/write/delete) if the file leaks.

```
DATABASE_URL=postgresql://postgres.fkljxglhbozvlwkhithd:Lakminaws123@aws-1-...
DIRECT_URL=postgresql://postgres.fkljxglhbozvlwkhithd:Lakminaws123@aws-1-...
```

The Supabase postgres password `Lakminaws123` is stored in plaintext and is the same for both the pooler and direct connection strings.

**Fix:**
- Rotate the Supabase DB password immediately via the Supabase dashboard.
- Confirm `.env` is in `.gitignore` (it is) and has never been staged with `git status` or `git log -- .env`.
- Use a secrets manager (e.g. Doppler, AWS Secrets Manager, or Supabase Vault) instead of a flat `.env` file for production.

---

#### C-3 · WebSocket Gateway Broadcasts to All Connected Clients
**File:** `apps/api/src/modules/events/events.gateway.ts`  
**Risk:** Any authenticated user can receive real-time events (task status, sniper triggers, bot competition alerts, bundle status) belonging to other users.

```ts
@WebSocketGateway({ cors: true, namespace: "/events" })
export class EventsGateway {
  publish(event: MintEventName, payload: unknown) {
    this.server?.emit?.(event, payload);   // ← broadcasts to ALL clients
  }

  emitSniperTriggered(userId: string, sniperTask: unknown) {
    this.server?.emit?.("sniper.triggered", { userId, sniperTask }); // ← all clients receive userId + task
  }
}
```

Every connected client receives events for every other user, including wallet task details and sniper data.

**Fix:** Use Socket.IO rooms keyed by userId. On connection, authenticate the socket (verify the Bearer token), then join the user to a private room:
```ts
socket.join(`user:${userId}`);
// and emit to:
this.server.to(`user:${userId}`).emit(event, payload);
```

---

### HIGH

---

#### H-1 · No HTTPS — Traffic Sent in Plaintext
**File:** `infra/nginx/default.conf`  
**Risk:** Auth tokens, wallet data, and mint task details are transmitted unencrypted. Susceptible to MITM on any non-local network.

The nginx config only listens on port 80 with no TLS redirect or HTTPS block.

**Fix:** Obtain a TLS certificate (Let's Encrypt via Certbot is free) and add an HTTPS server block with HTTP→HTTPS redirect. Minimum config:
```nginx
server {
  listen 443 ssl;
  ssl_certificate /etc/letsencrypt/live/yourdomain/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/yourdomain/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ...
}
server {
  listen 80;
  return 301 https://$host$request_uri;
}
```

---

#### H-2 · ThrottlerGuard Not Applied Globally
**File:** `apps/api/src/modules/app.module.ts`  
**Risk:** Brute-force and DoS attacks on all API endpoints. ThrottlerModule is imported (120 req/60s) but the guard is not registered as a global guard, so it protects nothing unless explicitly added to each controller.

**Fix:** Register the guard globally in `main.ts`:
```ts
import { ThrottlerGuard } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";

// In AppModule providers:
{ provide: APP_GUARD, useClass: ThrottlerGuard }
```
Or apply it in `AppModule` providers array.

---

#### H-3 · No Security Headers (Missing Helmet)
**File:** `apps/api/src/main.ts`  
**Risk:** Clickjacking, MIME sniffing, cross-site scripting, and information disclosure via server header.

The NestJS app has no Helmet middleware. No `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Content-Security-Policy`, or `X-Powered-By` suppression.

**Fix:**
```ts
import helmet from "helmet";
app.use(helmet());
```

---

#### H-4 · Redis Has No Authentication
**File:** `docker-compose.yml`  
**Risk:** Any process that can reach the Redis container (including compromised co-tenant containers or misconfigured firewall) can read/write all queued jobs, including signed transactions and encrypted wallet data held in memory during processing.

```yaml
redis:
  image: redis:7-alpine
  command: ["redis-server", "--appendonly", "yes", "--appendfsync", "everysec"]
  # No requirepass, no ACL
```

**Fix:**
```yaml
command: ["redis-server", "--requirepass", "${REDIS_PASSWORD}", "--appendonly", "yes"]
```
Add `REDIS_PASSWORD` to `.env` and update `REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379`.

---

#### H-5 · X-Forwarded-For IP Spoofing
**File:** `apps/api/src/modules/auth/auth.guard.ts` lines 55–59  
**Risk:** Any client can forge their IP address by setting `X-Forwarded-For`, making IP-based fraud detection (multi-account detection, rapid signup rules) ineffective. `lastSeenIp` tracking is also unreliable.

```ts
const xff = request.headers["x-forwarded-for"];
const ip = (typeof xff === "string" && xff.split(",")[0]?.trim()) || ...
```

The first IP in `X-Forwarded-For` is client-controlled.

**Fix:** Configure nginx to set a trusted `X-Real-IP` header and use only that, or use `proxy_set_header X-Forwarded-For $remote_addr` (overwrite, not append) so the header reflects the real upstream IP, not a client-supplied value.

---

#### H-6 · WebSocket CORS Wildcard
**File:** `apps/api/src/modules/events/events.gateway.ts` line 26  
**Risk:** Any origin can establish a WebSocket connection to the events namespace.

```ts
@WebSocketGateway({ cors: true, namespace: "/events" })
```

**Fix:** Restrict to your known origin, same as the HTTP CORS config:
```ts
@WebSocketGateway({ cors: { origin: process.env.NEXT_PUBLIC_APP_URL }, namespace: "/events" })
```

---

### MEDIUM

---

#### M-1 · Internal Database Error Messages Leaked to Clients
**File:** `apps/api/src/modules/auth/auth.guard.ts` lines 42–48  
**Risk:** Internal Prisma error messages (table names, constraint names, schema details) are sent to clients in 500 responses, aiding attackers in mapping the database schema.

```ts
throw new InternalServerErrorException("Database error: " + msg);
```

**Fix:** Log the full error server-side, return a generic message to the client:
```ts
logger.error({ err: dbErr }, "Auth DB error");
throw new InternalServerErrorException("An internal error occurred. Please try again.");
```

---

#### M-2 · Admin Role Stored as Unvalidated String
**File:** `prisma/schema.prisma` line 67  
**Risk:** The `role` field is `String @default("user")` with no enum constraint at the DB level. A bug or direct DB write could set an unexpected role string that bypasses role checks.

**Fix:** Create a Prisma enum `UserRole { user admin support }` and use it for the `role` field. This enforces valid values at the DB level.

---

#### M-3 · Bulk Wallet Import Has No Rate Limiting
**File:** `apps/api/src/modules/domains/wallets.module.ts` lines 173–179  
**Risk:** A single authenticated request can import an unlimited number of wallets, consuming server CPU (Argon2 KDF per wallet) and DB connections without bound.

```ts
@Post("bulk-import")
async bulkImport(@CurrentUser() user: CurrentUserType, @Body() body: BulkImportWalletDto) {
  for (const wallet of body.wallets) {   // no limit
    created.push(await this.importWallet(user, wallet));
  }
}
```

**Fix:** Add a maximum batch size (e.g. 50 wallets per request) and validate it in the DTO with `@ArrayMaxSize(50)`.

---

#### M-4 · Supabase Client Instantiated Per Request
**File:** `apps/api/src/modules/auth/auth.guard.ts` lines 24–29  
**Risk:** A new Supabase client (with service role key) is created on every authenticated request. This is a performance issue and means the service role key is handled in memory more frequently than necessary.

**Fix:** Inject a singleton Supabase client via NestJS DI (provide it in `AuthModule` using a custom provider) and reuse it across requests.

---

#### M-5 · Server IP Hardcoded in Deploy Script
**File:** `deploy.sh` line 9  
**Risk:** Server IP `5.161.224.125` is committed in source code, making infrastructure enumeration trivial for anyone with repo access.

**Fix:** Pass the server IP as an environment variable or argument: `SERVER_IP="${1:-$DEPLOY_HOST}"`.

---

#### M-6 · Missing Input Validation on `metric` Parameter in Timeseries
**File:** `apps/api/src/modules/domains/admin.module.ts` lines 527–579  
**Risk:** The `metric` query parameter is compared with string equality but there is no DTO/enum validation — the code falls through to a `BadRequestException` which still reveals valid metric names in its message.

**Fix:** Use a class-validator `@IsIn(["signups", "mints_attempted", "mints_completed", "active_users"])` on the query param DTO.

---

### LOW

---

#### L-1 · Client-Side Admin Guard
**File:** `apps/web/src/app/admin/admin-guard.tsx`  
**Risk:** The admin UI is protected only by a client-side React check. The page source code (JS bundles) for all admin pages is served to any authenticated user who requests it. This is a low risk because all sensitive data access requires server-side API calls that are properly protected, but it leaks the admin UI structure.

**Note:** This is acceptable if the API is the security boundary (which it is). The risk is UI disclosure, not data disclosure.

---

#### L-2 · Search Query Param May Appear in Logs
**File:** `apps/api/src/modules/domains/wallets.module.ts` line 202  
**Risk:** `GET /api/wallets?search=0xABCD...` — wallet addresses appear in the URL and may be logged by nginx or intermediate proxies.

**Fix:** Move search to a POST body or ensure nginx/access logs are not retaining query strings.

---

#### L-3 · RPC URLs Embed API Keys — Not Redacted in Logs
**File:** `packages/logger/src/index.ts`, `.env` lines 14–20  
**Risk:** RPC URLs contain embedded API keys in the path (e.g., `quiknode.pro/21def1a96e...`). These URLs are passed around the codebase and may be logged as part of error messages or context objects. The logger's `REDACT_PATHS` list does not cover `rpcUrl`, `url`, or `BASE_RPC_*` / `ETH_RPC_*`.

**Fix:** Add RPC URL fields to the redaction list, or strip API keys from URLs before logging. Alternatively, use RPC providers that accept API keys as headers rather than URL paths.

---

#### L-4 · Docker Services Have No Resource Limits
**File:** `docker-compose.yml`  
**Risk:** A runaway worker process (e.g., infinite retry loop) can consume all host memory/CPU, causing denial of service for all services.

**Fix:** Add `deploy.resources.limits` to each service:
```yaml
deploy:
  resources:
    limits:
      cpus: "1.0"
      memory: 512M
```

---

#### L-5 · `prefer-frozen-lockfile=false` in `.npmrc`
**File:** `.npmrc` line 6  
**Risk:** Setting `prefer-frozen-lockfile=false` means `pnpm install` may silently update the lockfile, allowing different dependency versions to be installed across environments. This is a supply-chain hygiene issue.

**Fix:** Set `prefer-frozen-lockfile=true` for CI/production installs.

---

## What's Done Well

These areas were reviewed and found to be implemented correctly:

- **Wallet encryption** — Argon2id KDF + AES-256-GCM with random salt/IV per key, AAD version tag, timing-safe comparison, key material zeroed after use (`packages/wallet-crypto/src/index.ts`). This is excellent.
- **Private key never returned to clients** — `safeWalletSelect` in `wallets.module.ts` explicitly excludes all encrypted key fields from API responses.
- **Prisma parameterized queries** — No raw SQL concatenation found; all DB queries go through Prisma's type-safe API, eliminating SQL injection.
- **Auth guard covers all protected routes** — `@UseGuards(AuthGuard)` is applied at the controller level; all admin routes additionally use `RoleGuard` with `@AdminOnly()`.
- **Admin self-protection** — Guards prevent admins from banning or deleting themselves.
- **Log redaction** — `pino` redact paths cover all major secret fields (private keys, tokens, API keys, DB URLs).
- **Audit logging** — All admin actions (role changes, bans, plan changes, fraud resolution) are written to `SecurityAuditLog`.
- **Fraud detection** — Built-in rules for multi-account IP sharing, rapid signup, and key reuse detection.
- **Global validation pipe** — `ValidationPipe({ whitelist: true, transform: true })` strips unknown properties from all request bodies.
- **CORS restricted to known origin** — HTTP CORS is properly scoped to `NEXT_PUBLIC_APP_URL`.

---

## Priority Remediation Order

| Priority | ID | Issue |
|---|---|---|
| 🔴 Now | C-1 | Rotate Flashbots private key |
| 🔴 Now | C-2 | Rotate Supabase DB password |
| 🔴 Now | C-3 | Fix WebSocket user isolation |
| 🟠 Before launch | H-1 | Enable HTTPS/TLS |
| 🟠 Before launch | H-2 | Apply ThrottlerGuard globally |
| 🟠 Before launch | H-3 | Add Helmet middleware |
| 🟠 Before launch | H-4 | Add Redis password |
| 🟠 Before launch | H-5 | Fix X-Forwarded-For trust |
| 🟡 Soon | M-1 | Sanitize error messages |
| 🟡 Soon | M-3 | Bulk import size limit |
| 🟡 Soon | M-5 | Remove hardcoded server IP |
| 🟢 Backlog | L-3 | Redact RPC URLs in logs |
| 🟢 Backlog | L-4 | Add Docker resource limits |
