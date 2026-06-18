#!/usr/bin/env bash
set -euo pipefail

SOURCE_REPO="${SOURCE_REPO:-/root/app}"
TARGET_REPO="${TARGET_REPO:-/opt/astryn}"
FILES_TO_COPY=(
  "apps/web/src/app/mint-setup/page.tsx"
  "apps/web/src/app/logs/page.tsx"
  "apps/worker/src/processors/mint-task.processor.ts"
  "apps/worker/src/processors/direct-mint.processor.ts"
  "packages/blockchain/src/index.ts"
  "packages/rpc-pool/src/index.ts"
)

echo "Pulling latest main in ${SOURCE_REPO}..."
cd "${SOURCE_REPO}"
git pull --ff-only origin main

echo "Copying updated app files to ${TARGET_REPO}..."
for file_path in "${FILES_TO_COPY[@]}"; do
  if [[ ! -f "${SOURCE_REPO}/${file_path}" ]]; then
    echo "Missing source file: ${SOURCE_REPO}/${file_path}" >&2
    exit 1
  fi
  mkdir -p "$(dirname "${TARGET_REPO}/${file_path}")"
  cp "${SOURCE_REPO}/${file_path}" "${TARGET_REPO}/${file_path}"
done

echo "Rebuilding and restarting web + worker services..."
cd "${TARGET_REPO}"
docker compose build --no-cache web worker
docker compose up -d web worker

echo "Service status:"
docker compose ps web worker
