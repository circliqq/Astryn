#!/bin/bash
# ============================================================
#  Astryn — Fast pull & rebuild (web + worker only)
#  Run ON the VPS:  bash /opt/astryn/pull-deploy.sh
# ============================================================
set -e

SRC="/root/app"
DEST="/opt/astryn"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   Astryn — Pull & Rebuild            ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── 1. Pull latest code ───────────────────────────────────────
echo "▶ Pulling latest from GitHub..."
cd "$SRC"
git pull --ff-only origin main
echo "✓ Git pull done."
echo ""

# ── 2. Copy changed files to /opt/astryn ─────────────────────
echo "▶ Syncing files to $DEST..."

FILES=(
  "apps/web/src/app/whitelist-checker/page.tsx"
  "apps/web/src/app/logs/page.tsx"
  "apps/web/src/app/mint-setup/page.tsx"
  "apps/worker/src/processors/mint-task.processor.ts"
  "apps/worker/src/processors/direct-mint.processor.ts"
  "packages/blockchain/src/index.ts"
  "packages/rpc-pool/src/index.ts"
  "packages/opensea/src/index.ts"
  "packages/opensea/dist/index.d.ts"
)

for FILE in "${FILES[@]}"; do
  SRC_FILE="$SRC/$FILE"
  DEST_FILE="$DEST/$FILE"
  if [ -f "$SRC_FILE" ]; then
    mkdir -p "$(dirname "$DEST_FILE")"
    cp "$SRC_FILE" "$DEST_FILE"
    echo "  ✓ $FILE"
  else
    echo "  ⚠ Skipped (not found): $FILE"
  fi
done

echo ""

# ── 3. Rebuild web + worker only ──────────────────────────────
echo "▶ Building web & worker images..."
cd "$DEST"
docker compose build --no-cache web worker

echo ""
echo "▶ Restarting web & worker..."
docker compose up -d web worker

echo ""
echo "▶ Container status:"
docker compose ps web worker

echo ""
echo "╔══════════════════════════════════════╗"
echo "║  ✅  Deploy done!                    ║"
echo "╚══════════════════════════════════════╝"
echo ""
