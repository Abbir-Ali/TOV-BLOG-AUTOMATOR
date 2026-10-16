#!/usr/bin/env bash
# =============================================================================
# TOV Blog MCP — deploy script
# Usage (from project root, Git Bash or WSL on Windows):
#   ./deploy.sh
# Or with overrides:
#   SERVER_USER=deploy SERVER_HOST=1.2.3.4 SERVER_PATH=/srv/tov-blog-mcp ./deploy.sh
# =============================================================================

set -euo pipefail

# ---------- Load .env if present ----------
# Lets you keep SERVER_HOST / SERVER_USER / SERVER_PATH etc. in .env.
# Inline/shell overrides still win because we only export keys not already set.
if [[ -f .env ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    # skip blanks and comments
    [[ -z "${line// }" || "$line" == \#* ]] && continue
    # only KEY=VALUE lines
    [[ "$line" != *=* ]] && continue
    key="${line%%=*}"
    key="${key// }"                      # trim spaces around key
    [[ -z "$key" || "$key" == \#* ]] && continue
    # don't clobber a value already set in the shell/CLI
    if [[ -z "${!key:-}" ]]; then
      val="${line#*=}"
      val="${val%\"}"; val="${val#\"}"   # strip surrounding double quotes
      val="${val%\'}"; val="${val#\'}"   # strip surrounding single quotes
      export "$key=$val"
    fi
  done < .env
fi

# ---------- Config (override with env vars or edit here) ----------
SERVER_USER="${SERVER_USER:-ubuntu}"
SERVER_HOST="${SERVER_HOST:-YOUR_SERVER_IP}"
SERVER_PATH="${SERVER_PATH:-/srv/tov-blog-mcp}"
SUPERVISOR_NAME="${SUPERVISOR_NAME:-tov-blog-mcp}"
DEPLOY_ARCHIVE="tov-blog-mcp-deploy.tar.gz"
# ------------------------------------------------------------------

STAGE_DIR=".deploy-stage"

echo "==> [1/5] Building TypeScript..."
npm run build

echo "==> [2/5] Staging prod node_modules (local working tree untouched)..."
# Build a clean production-only dependency tree in a staging dir so your local
# dev deps (vitest/typescript) are not disturbed. The server runs NOTHING —
# no npm install, no build — so everything it needs must be in the archive.
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
cp package.json package-lock.json "$STAGE_DIR"/
( cd "$STAGE_DIR" && npm ci --omit=dev --ignore-scripts )

echo "==> [3/5] Packing dist/ + node_modules + package manifests + supervisor/..."
tar \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='secrets' \
  --exclude='runs' \
  --exclude='.git' \
  --exclude='tests' \
  --exclude='.kiro' \
  -czf "$DEPLOY_ARCHIVE" \
  dist/ \
  package.json \
  package-lock.json \
  supervisor/ \
  -C "$STAGE_DIR" node_modules

echo "==> [4/5] Uploading and extracting on $SERVER_USER@$SERVER_HOST:$SERVER_PATH ..."
ssh "$SERVER_USER@$SERVER_HOST" "mkdir -p $SERVER_PATH"
scp "$DEPLOY_ARCHIVE" "$SERVER_USER@$SERVER_HOST:/tmp/$DEPLOY_ARCHIVE"
# Server-side: extract only. No npm install, no build (box can't run them).
ssh "$SERVER_USER@$SERVER_HOST" bash << EOF
  set -e
  cd $SERVER_PATH
  tar -xzf /tmp/$DEPLOY_ARCHIVE --overwrite
  rm -f /tmp/$DEPLOY_ARCHIVE
  echo "Extraction complete."
EOF

echo "==> [5/5] Restarting supervisor service: $SUPERVISOR_NAME ..."
ssh "$SERVER_USER@$SERVER_HOST" \
  "sudo supervisorctl restart $SUPERVISOR_NAME && sudo supervisorctl status $SUPERVISOR_NAME"

rm -rf "$STAGE_DIR"
rm -f "$DEPLOY_ARCHIVE"
echo ""
echo "==> Deploy complete!"
echo "    Health check: https://YOUR_DOMAIN/health"
