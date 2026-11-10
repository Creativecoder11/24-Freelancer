#!/usr/bin/env bash
set -e

# Load NVM and PNPM environment in non-interactive shell
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$HOME/.bashrc" ] && source "$HOME/.bashrc" 2>/dev/null || true

export PATH="$HOME/.local/share/pnpm:$PATH"

cd /var/www/24-Freelancer

echo "==> [1/5] Pulling latest code from GitHub..."
git pull origin main

echo "==> [2/5] Installing dependencies..."
pnpm install

echo "==> [3/5] Generating Prisma client..."
pnpm run db:generate

echo "==> [4/5] Building all applications..."
pnpm -r run build

echo "==> [5/5] Starting / Reloading PM2 services via ecosystem.config.cjs..."
pm2 startOrReload ecosystem.config.cjs --update-env || pm2 restart ecosystem.config.cjs || pm2 start ecosystem.config.cjs

echo "==> Deployment finished successfully!"
