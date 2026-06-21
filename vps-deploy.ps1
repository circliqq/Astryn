$SSH_KEY  = "$env:USERPROFILE\.ssh\astryn"
$SERVER   = "root@5.161.224.125"
$COMMANDS = @"
set -e
cd /root/app
git pull --ff-only origin main

# ── New dirs ────────────────────────────────────────────────
mkdir -p /opt/astryn/apps/web/src/app/bundle-mint
mkdir -p /opt/astryn/contracts

# ── Web ─────────────────────────────────────────────────────
cp /root/app/apps/web/src/app/bundle-mint/page.tsx /opt/astryn/apps/web/src/app/bundle-mint/page.tsx
cp /root/app/apps/web/src/components/sidebar.tsx /opt/astryn/apps/web/src/components/sidebar.tsx

# ── Worker ──────────────────────────────────────────────────
cp /root/app/apps/worker/src/processors/bundle-mint.processor.ts /opt/astryn/apps/worker/src/processors/bundle-mint.processor.ts
cp /root/app/apps/worker/src/main.ts /opt/astryn/apps/worker/src/main.ts

# ── API ─────────────────────────────────────────────────────
cp /root/app/apps/api/src/modules/domains/bundle-mint.module.ts /opt/astryn/apps/api/src/modules/domains/bundle-mint.module.ts
cp /root/app/apps/api/src/modules/app.module.ts /opt/astryn/apps/api/src/modules/app.module.ts
cp /root/app/apps/api/src/modules/events/events.gateway.ts /opt/astryn/apps/api/src/modules/events/events.gateway.ts

# ── Packages ────────────────────────────────────────────────
cp /root/app/packages/blockchain/src/index.ts /opt/astryn/packages/blockchain/src/index.ts

# ── Prisma schema + migrations + contract ───────────────────
cp /root/app/prisma/schema.prisma /opt/astryn/prisma/schema.prisma
cp -r /root/app/prisma/migrations/. /opt/astryn/prisma/migrations/
cp /root/app/contracts/BundleMint7702.sol /opt/astryn/contracts/BundleMint7702.sol

cd /opt/astryn

# ── Ensure 7702 env keys exist (blank placeholders if missing) ──
grep -q '^BUNDLE_MINT_7702_EXECUTOR_ETH='  .env || echo 'BUNDLE_MINT_7702_EXECUTOR_ETH='  >> .env
grep -q '^BUNDLE_MINT_7702_EXECUTOR_BASE=' .env || echo 'BUNDLE_MINT_7702_EXECUTOR_BASE=' >> .env
grep -q '^ETH_FLASHBOTS_AUTH_KEY='         .env || echo 'ETH_FLASHBOTS_AUTH_KEY='         >> .env

# ── Rebuild + restart (web, worker, api all changed) ────────
docker compose build --no-cache web worker api
docker compose up -d web worker api

# ── DB migration: run INSIDE the api container (host has no npx) ──
sleep 8
docker compose exec -T api npx prisma migrate deploy --schema prisma/schema.prisma

docker compose ps web worker api
"@

Write-Host "=== Deploying Bundle Mint + 7702 to VPS ===" -ForegroundColor Cyan
ssh -i $SSH_KEY -o StrictHostKeyChecking=no $SERVER $COMMANDS
Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
