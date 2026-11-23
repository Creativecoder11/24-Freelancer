#!/usr/bin/env bash
# Remove the demo users (emails ending in @example.com or .example) from the LIVE database.
# Real accounts are kept. The SSH password is asked once.
#
#   scripts/remove-demo-users-live.sh
#
# Steps: copies packages/db/sql/remove-demo-users.sql to the server, shows who would be removed,
# asks you to confirm, backs up the live database on the server, then deletes.
# Overrides: LIVE_SSH=root@201.18.222.60  LIVE_DIR=/var/www/24-Freelancer
set -euo pipefail
cd "$(dirname "$0")/.."

LIVE_SSH=${LIVE_SSH:-root@201.18.222.60}
LIVE_DIR=${LIVE_DIR:-/var/www/24-Freelancer}
SQL=packages/db/sql/remove-demo-users.sql
STAMP=$(date +%Y%m%d-%H%M%S)
WORK=$(mktemp -d)
SOCK="$WORK/ssh.sock"
cleanup() { ssh -S "$SOCK" -O exit "$LIVE_SSH" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "==> Connecting to $LIVE_SSH (enter the server password)…"
ssh -fN -M -S "$SOCK" -o ControlPersist=600 "$LIVE_SSH"
remote() { ssh -S "$SOCK" "$LIVE_SSH" "$@"; }

scp -q -o ControlPath="$SOCK" "$SQL" "$LIVE_SSH:/tmp/remove-demo-users.sql"

# Runs on the server: finds the live DATABASE_URL the way the API loads it, then runs psql or
# pg_dump with it, falling back to the local postgres system user if the password is rejected.
REMOTE_LIB=$(cat <<'LIB'
set -eo pipefail
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
U=$(cd "$API" && node -e '
  for (const f of [".env", ".env.local", "../../.env"]) { try { process.loadEnvFile(f) } catch {} if (process.env.DATABASE_URL) break }
  const u = process.env.DATABASE_URL; if (!u) process.exit(1);
  const x = new URL(u); const keep = new Set(["sslmode","sslrootcert","sslcert","sslkey","connect_timeout"]);
  for (const k of [...x.searchParams.keys()]) if (!keep.has(k)) x.searchParams.delete(k);
  process.stdout.write(x.toString())') || { echo "No DATABASE_URL found under $API." >&2; exit 1; }
DB=$(U="$U" node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.U).pathname.slice(1)) || "postgres")')
cd /tmp
as_postgres() { if command -v runuser >/dev/null; then runuser -u postgres -- "$@"; else sudo -u postgres "$@"; fi; }
if psql -X -At --dbname="$U" -c 'select 1' >/dev/null 2>&1; then
  db_psql() { psql -X --dbname="$U" "$@"; }; db_dump() { pg_dump --dbname="$U" "$@"; }
else
  db_psql() { as_postgres psql -X -d "$DB" "$@"; }; db_dump() { as_postgres pg_dump -d "$DB" "$@"; }
fi
LIB
)
on_server() { { printf '%s\n' "$REMOTE_LIB"; cat; } | remote "API='$LIVE_DIR/apps/api' bash -s"; }

echo "==> Preview (nothing is changed yet):"
echo 'db_psql -f /tmp/remove-demo-users.sql' | on_server

echo
read -r -p "Delete the demo users listed above from the LIVE site? Type yes to continue: " ok
[ "$ok" = yes ] || { echo "Cancelled. Nothing was changed."; remote "rm -f /tmp/remove-demo-users.sql"; exit 0; }

echo "==> Backing up the live database to /root/24f-backups/before-demo-removal-$STAMP.dump…"
on_server <<CMD
mkdir -p /root/24f-backups
db_dump -Fc > /root/24f-backups/before-demo-removal-$STAMP.dump
test -s /root/24f-backups/before-demo-removal-$STAMP.dump
CMD

echo "==> Deleting…"
echo 'db_psql -v ON_ERROR_STOP=1 -v confirm=DELETE-DEMO-USERS -f /tmp/remove-demo-users.sql' | on_server
remote "rm -f /tmp/remove-demo-users.sql"

echo
echo "Done. The admin Users page on the live site now shows only real accounts (refresh it)."
echo "Backup on the server: /root/24f-backups/before-demo-removal-$STAMP.dump"
echo "Restore with: pg_restore --clean --if-exists -d <db> /root/24f-backups/before-demo-removal-$STAMP.dump"
