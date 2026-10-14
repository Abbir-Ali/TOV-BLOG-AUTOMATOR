#!/usr/bin/env bash
# =============================================================================
# TOV Blog MCP — deploy script
# Usage (from project root, Git Bash or WSL on Windows):
#   ./deploy.sh
# Or with overrides:
#   SERVER_USER=deploy SERVER_HOST=1.2.3.4 SERVER_PATH=/opt/tov-blog-mcp ./deploy.sh
# =============================================================================

set -euo pipefail

# ---------- Config (override with env vars or edit here) ----------
SERVER_USER="${SERVER_USER:-ubuntu}"
SERVER_HOST="${SERVER_HOST:-YOUR_SERVER_IP}"
SERVER_PATH="${SERVER_PATH:-/opt/tov-blog-mcp}"
SSH_KEY="${SSH_KEY:-~/.ssh/id_rsa}"          # path to your private SSH key
SUPERVISOR_NAME="${SUPERVISOR_NAME:-tov-blog-mcp}"
DEPLOY_ARCHIVE="tov-blog-mcp-deploy.tar.gz"
# ------------------------------------------------------------------

echo "==> [1/5] Building TypeScript..."
npm run build

echo "==> [2/5] Packing dist/ + package.json + package-lock.json..."
tar \
  --exclude='node_modules' \
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
  supervisor/

echo "==> [3/5] Uploading to $SERVER_USER@$SERVER_HOST:$SERVER_PATH ..."
ssh -i "$SSH_KEY" "$SERVER_USER@$SERVER_HOST" "mkdir -p $SERVER_PATH"
scp -i "$SSH_KEY" "$DEPLOY_ARCHIVE" "$SERVER_USER@$SERVER_HOST:/tmp/$DEPLOY_ARCHIVE"

echo "==> [4/5] Extracting and installing on server..."
ssh -i "$SSH_KEY" "$SERVER_USER@$SERVER_HOST" bash << EOF
  set -e
  cd $SERVER_PATH
  tar -xzf /tmp/$DEPLOY_ARCHIVE --overwrite
  rm -f /tmp/$DEPLOY_ARCHIVE
  npm install --omit=dev --ignore-scripts
  echo "Extraction complete."
EOF

echo "==> [5/5] Restarting supervisor service: $SUPERVISOR_NAME ..."
ssh -i "$SSH_KEY" "$SERVER_USER@$SERVER_HOST" \
  "sudo supervisorctl restart $SUPERVISOR_NAME && sudo supervisorctl status $SUPERVISOR_NAME"

rm -f "$DEPLOY_ARCHIVE"
echo ""
echo "==> Deploy complete!"
echo "    Health check: https://YOUR_DOMAIN/health"
