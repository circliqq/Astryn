# ============================================================
#  Upload Astryn to Hetzner VPS
#  Run this from PowerShell on your Windows machine.
#  Requirements: OpenSSH must be installed (Windows 10/11 default)
# ============================================================

$SERVER_IP  = "178.104.70.37"
$SERVER_USER = "root"
$LOCAL_PATH  = "C:\Users\senar\OneDrive\Desktop\Gas mode\GasWarMode"
$REMOTE_PATH = "/opt/astryn"

Write-Host ""
Write-Host "=== Astryn — Upload to Server ===" -ForegroundColor Cyan
Write-Host "Server : $SERVER_USER@$SERVER_IP"
Write-Host "Local  : $LOCAL_PATH"
Write-Host "Remote : $REMOTE_PATH"
Write-Host ""

# ── Step 1: Create remote folder ─────────────────────────────
Write-Host "Creating remote folder..." -ForegroundColor Yellow
ssh "${SERVER_USER}@${SERVER_IP}" "mkdir -p $REMOTE_PATH"

# ── Step 2: Upload project (exclude heavy folders) ────────────
Write-Host "Uploading project files (this may take a minute)..." -ForegroundColor Yellow
scp -r `
  "$LOCAL_PATH\apps" `
  "$LOCAL_PATH\packages" `
  "$LOCAL_PATH\prisma" `
  "$LOCAL_PATH\infra" `
  "$LOCAL_PATH\package.json" `
  "$LOCAL_PATH\pnpm-workspace.yaml" `
  "$LOCAL_PATH\turbo.json" `
  "$LOCAL_PATH\tsconfig.base.json" `
  "$LOCAL_PATH\docker-compose.yml" `
  "$LOCAL_PATH\.env" `
  "$LOCAL_PATH\deploy.sh" `
  "${SERVER_USER}@${SERVER_IP}:${REMOTE_PATH}/"

# ── Step 3: Run deploy script on server ───────────────────────
Write-Host ""
Write-Host "Running deploy script on server..." -ForegroundColor Yellow
ssh "${SERVER_USER}@${SERVER_IP}" "cd $REMOTE_PATH && chmod +x deploy.sh && ./deploy.sh"

Write-Host ""
Write-Host "=== Done! Open http://$SERVER_IP in your browser ===" -ForegroundColor Green
