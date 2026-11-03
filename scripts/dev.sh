#!/usr/bin/env bash
# Start the 24 Freelancing stack locally: PostgreSQL + Redis (Homebrew), API :4000, web :3005.
# Logs: /tmp/fl-api.log, /tmp/fl-web.log. Stop with: scripts/dev.sh stop
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.nvm/versions/node/v22.23.4/bin:$PATH"   # Node 22 required (D-37)

stop() {
  for port in 4000 3005; do
    pid=$(lsof -nP -iTCP:$port -sTCP:LISTEN -t 2>/dev/null || true)
    [ -n "$pid" ] && kill $pid && echo "stopped :$port ($pid)"
  done
}
if [ "${1:-}" = "stop" ]; then stop; exit 0; fi

brew services start postgresql@16 >/dev/null 2>&1 || true
brew services start redis >/dev/null 2>&1 || true
stop || true

echo "Building API…"
(cd apps/api && pnpm build >/tmp/fl-api-build.log 2>&1) || { echo "API build failed — see /tmp/fl-api-build.log"; exit 1; }
(cd apps/api && nohup node dist/main.js >/tmp/fl-api.log 2>&1 &)
(cd apps/web && nohup npx next dev -p 3005 >/tmp/fl-web.log 2>&1 &)

for i in $(seq 1 30); do curl -sf localhost:4000/healthz >/dev/null && break; sleep 1; done
for i in $(seq 1 60); do curl -sf -o /dev/null localhost:3005/ && break; sleep 1; done
cat <<MSG

  Website   http://localhost:3005
  API       http://localhost:4000/api/v1   (health: /healthz)

  Demo logins (password Password1!):
    Worker    nusrat.j@example.com
    Employer  accounts@shelfwise.example
  Sign-in codes (OTP) are printed, not sent, in dev:  scripts/otp.sh

MSG
