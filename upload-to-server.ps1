$SERVER_IP   = "5.161.224.125"
$SERVER_USER = "root"
$LOCAL_PATH  = "C:\Users\senar\OneDrive\Desktop\Gas mode\GasWarMode"
$REMOTE_PATH = "/opt/astryn"
$SSH_KEY     = "$env:USERPROFILE\.ssh\astryn"
$TEMP_PATH   = "$env:TEMP\astryn_upload"

Write-Host "=== Astryn Upload to Server ===" -ForegroundColor Cyan
Write-Host "Server : $SERVER_USER@$SERVER_IP"
Write-Host ""

Write-Host "Preparing files - no node_modules..." -ForegroundColor Yellow
if (Test-Path $TEMP_PATH) { Remove-Item -Recurse -Force $TEMP_PATH }
New-Item -ItemType Directory -Path $TEMP_PATH -Force | Out-Null

robocopy "$LOCAL_PATH\apps"     "$TEMP_PATH\apps"     /E /XD node_modules .next .turbo
robocopy "$LOCAL_PATH\packages" "$TEMP_PATH\packages" /E /XD node_modules
robocopy "$LOCAL_PATH\prisma"   "$TEMP_PATH\prisma"   /E
robocopy "$LOCAL_PATH\infra"    "$TEMP_PATH\infra"    /E

Copy-Item "$LOCAL_PATH\package.json"        "$TEMP_PATH\"
Copy-Item "$LOCAL_PATH\pnpm-workspace.yaml" "$TEMP_PATH\"
Copy-Item "$LOCAL_PATH\turbo.json"          "$TEMP_PATH\"
Copy-Item "$LOCAL_PATH\tsconfig.base.json"  "$TEMP_PATH\"
Copy-Item "$LOCAL_PATH\docker-compose.yml"  "$TEMP_PATH\"
Copy-Item "$LOCAL_PATH\.env"                "$TEMP_PATH\"
Copy-Item "$LOCAL_PATH\deploy.sh"           "$TEMP_PATH\"

Write-Host "Files ready." -ForegroundColor Green
Write-Host ""

Write-Host "Creating remote folder..." -ForegroundColor Yellow
ssh -i $SSH_KEY "${SERVER_USER}@${SERVER_IP}" "mkdir -p $REMOTE_PATH"

Write-Host "Uploading project files..." -ForegroundColor Yellow
scp -i $SSH_KEY -r "$TEMP_PATH\." "${SERVER_USER}@${SERVER_IP}:${REMOTE_PATH}/"

Write-Host ""
Write-Host "Running deploy script on server..." -ForegroundColor Yellow
ssh -i $SSH_KEY "${SERVER_USER}@${SERVER_IP}" "cd $REMOTE_PATH && chmod +x deploy.sh && ./deploy.sh"

Write-Host ""
Write-Host "=== Done! Open http://$SERVER_IP ===" -ForegroundColor Green
