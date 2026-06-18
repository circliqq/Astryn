#!/usr/bin/env bash
set -euo pipefail

SOURCE_REPO="${SOURCE_REPO:-/root/app}"
TARGET_REPO="${TARGET_REPO:-/opt/astryn}"
PAGE_PATH="apps/web/src/app/mint-setup/page.tsx"

echo "Pulling latest main in ${SOURCE_REPO}..."
cd "${SOURCE_REPO}"
git pull --ff-only origin main

if [[ ! -f "${SOURCE_REPO}/${PAGE_PATH}" ]]; then
  echo "Missing source file: ${SOURCE_REPO}/${PAGE_PATH}" >&2
  exit 1
fi

echo "Copying ${PAGE_PATH} to ${TARGET_REPO}..."
mkdir -p "$(dirname "${TARGET_REPO}/${PAGE_PATH}")"
cp "${SOURCE_REPO}/${PAGE_PATH}" "${TARGET_REPO}/${PAGE_PATH}"

echo "Rebuilding and restarting web service..."
cd "${TARGET_REPO}"
docker compose build --no-cache web
docker compose up -d web

echo "Web service status:"
docker compose ps web
