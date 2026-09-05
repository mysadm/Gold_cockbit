#!/usr/bin/env bash
# Push local commits to GitHub, then deploy the updated code to the VPS
# dev/test environment (Docker Compose) and smoke-check it.
#
# Usage:
#   ./deploy.sh                  # push + deploy (fails if working tree is dirty)
#   ./deploy.sh "commit message" # also commit staged/tracked changes first
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

VPS_HOST="root@100.73.245.30"
VPS_REPO_PATH="~/apps/gold-cockpit/gold-cockpit"
VPS_DEPS_PATH="~/apps/gold-cockpit/AI_settings_card"
LOCAL_DEPS_PATH="../AI_settings_card"
SMOKE_URL="http://100.73.245.30:3577/api/wallet"

if [ -n "$(git status --porcelain)" ]; then
  if [ -n "${1:-}" ]; then
    echo "==> Committing local changes: $1"
    git add -A
    git commit -m "$1"
  else
    echo "Working tree has uncommitted changes. Commit them first, or run:"
    echo "  ./deploy.sh \"your commit message\""
    exit 1
  fi
fi

echo "==> Pushing to origin/main"
git push origin main

echo "==> Syncing sibling dependency (ai-settings-ui) to VPS"
rsync -az --exclude='node_modules' --exclude='.playwright-mcp' -e ssh \
  "$LOCAL_DEPS_PATH"/ "$VPS_HOST:$VPS_DEPS_PATH/"

echo "==> Pulling + rebuilding on VPS"
ssh "$VPS_HOST" "cd $VPS_REPO_PATH && git pull && docker compose up -d --build && docker compose ps"

echo "==> Smoke check"
sleep 3
code=$(curl -sS -m 8 -o /dev/null -w '%{http_code}' "$SMOKE_URL" || echo "000")
if [ "$code" = "200" ]; then
  echo "Deploy OK ($SMOKE_URL -> 200)"
else
  echo "Deploy check FAILED ($SMOKE_URL -> $code) -- check 'ssh $VPS_HOST docker logs gold-cockpit-app-1'"
  exit 1
fi
