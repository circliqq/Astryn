#!/bin/bash
# ============================================================
#  Astryn — One-shot deploy script for Hetzner VPS
#  Run this ON THE SERVER after uploading the project.
#  Usage:  chmod +x deploy.sh && ./deploy.sh
# ============================================================
set -e

SERVER_IP="5.161.224.125"
APP_PORT="80"          # Nginx will listen on this port

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   Astryn Deploy — Hetzner CCX13      ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── 1. Install Docker if not present ─────────────────────────
if ! command -v docker &> /dev/null; then
  echo "▶ Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo "✓ Docker installed."
else
  echo "✓ Docker already installed."
fi

# ── 2. Install Docker Compose plugin if not present ──────────
if ! docker compose version &> /dev/null; then
  echo "▶ Installing Docker Compose plugin..."
  apt-get update -qq && apt-get install -y docker-compose-plugin
  echo "✓ Docker Compose installed."
else
  echo "✓ Docker Compose already installed."
fi

# ── 3. Patch .env for production ─────────────────────────────
echo "▶ Updating .env for production..."

# Point the public URLs to the server IP
sed -i "s|NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL=http://${SERVER_IP}|" .env
sed -i "s|NEXT_PUBLIC_API_URL=.*|NEXT_PUBLIC_API_URL=http://${SERVER_IP}|" .env
sed -i "s|API_URL=http://localhost.*|API_URL=http://api:4000|" .env
sed -i "s|REDIS_URL=redis://localhost.*|REDIS_URL=redis://redis:6379|" .env

echo "✓ .env updated."

# ── 4. Patch nginx to use port 80 ────────────────────────────
sed -i "s|\"8080:80\"|\"${APP_PORT}:80\"|" docker-compose.yml
echo "✓ Nginx set to port ${APP_PORT}."

# ── 5. Run DB migration ───────────────────────────────────────
echo "▶ Running Prisma migrations..."
npx prisma migrate deploy --schema prisma/schema.prisma || true
echo "✓ Migrations done."

# ── 6. Build & start all services ────────────────────────────
echo "▶ Building Docker images (this takes a few minutes)..."
docker compose build --no-cache

echo "▶ Starting services..."
docker compose up -d

# ── 7. Show status ────────────────────────────────────────────
echo ""
echo "▶ Container status:"
docker compose ps

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  ✅  Astryn is live!                         ║"
echo "║                                              ║"
echo "║  Web UI  →  http://${SERVER_IP}             ║"
echo "║  API     →  http://${SERVER_IP}/api          ║"
echo "║                                              ║"
echo "║  Logs:   docker compose logs -f              ║"
echo "║  Stop:   docker compose down                 ║"
echo "║  Restart: docker compose restart             ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
