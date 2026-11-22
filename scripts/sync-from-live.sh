#!/usr/bin/env bash
# Make localhost match the live site: copy the live database, uploaded files and the PII keys
# that decrypt them from the VPS into your local setup. One-way (live -> local); nothing on the
# server is changed. The SSH password is asked once.
#
#   scripts/sync-from-live.sh
#
# Overrides: LIVE_SSH=root@201.18.222.60  LIVE_DIR=/var/www/24-Freelancer  LOCAL_DB=fl_dev
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)

LIVE_SSH=${LIVE_SSH:-root@201.18.222.60}
LIVE_DIR=${LIVE_DIR:-/var/www/24-Freelancer}
LOCAL_DB=${LOCAL_DB:-fl_dev}
LOCAL_ENV="$ROOT/apps/api/.env"
BACKUP_DIR="$HOME/24f-db-backups"
STAMP=$(date +%Y%m%d-%H%M%S)
WORK=$(mktemp -d)
SOCK="$WORK/ssh.sock"

cleanup() {
  ssh -S "$SOCK" -O exit "$LIVE_SSH" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

for bin in ssh rsync psql pg_dump createdb dropdb gzip; do
  command -v "$bin" >/dev/null || { echo "Missing $bin. Install it first (PostgreSQL: brew install postgresql@16)."; exit 1; }
done
[ -f "$LOCAL_ENV" ] || { echo "Missing $LOCAL_ENV"; exit 1; }

echo "==> [1/6] Connecting to $LIVE_SSH (enter the server password)…"
ssh -fN -M -S "$SOCK" -o ControlPersist=600 "$LIVE_SSH"
remote() { ssh -S "$SOCK" "$LIVE_SSH" "$@"; }

# Runs on the server. `resolve KEY` prints the value the live API really uses: the running fl-api
# process's environment first (pm2 / shell exports win), then the .env files in the order the API
# loads them (apps/api/src/config/env.ts), parsed by Node exactly as the API parses them.
REMOTE_LIB=$(cat <<'LIB'
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
export PATH="$HOME/.local/share/pnpm:$PATH"
resolve() {
  local key=$1 pid val
  # The API process: node running dist/main.js with apps/api as its working directory.
  for p in $(pgrep -f 'dist/main' 2>/dev/null); do
    [ "$(readlink "/proc/$p/cwd" 2>/dev/null)" = "$API" ] && { pid=$p; break; }
  done
  if [ -n "${pid:-}" ] && [ -r "/proc/$pid/environ" ]; then
    val=$(tr '\0' '\n' <"/proc/$pid/environ" | sed -n "s/^$key=//p" | head -1)
    if [ -n "$val" ]; then echo "    $key: from the running fl-api process" >&2; printf '%s' "$val"; return; fi
  elif [ "$key" = DATABASE_URL ]; then
    echo "    (no running API process found with working directory $API)" >&2
  fi
  (cd "$API" && KEY="$key" node -e '
    const k = process.env.KEY;
    for (const f of [".env", ".env.local", "../../.env"]) {
      try { process.loadEnvFile(f) } catch {}
      if (process.env[k] !== undefined) { console.error(`    ${k}: from apps/api/${f}`); break }
    }
    process.stdout.write(process.env[k] ?? "")')
}
LIB
)
on_server() { { printf '%s\n' "$REMOTE_LIB"; cat; } | remote "API='$LIVE_DIR/apps/api' bash -s"; }
live_env() { printf 'resolve %q\n' "$1" | on_server; }

echo "==> [2/6] Reading live settings…"
PII_MASTER=$(live_env PII_LOCAL_MASTER_KEY)
PII_BLIND=$(live_env PII_BLIND_INDEX_KEY)
PII_VER=$(live_env PII_KEY_VERSION)
STORAGE_DIR=$(live_env STORAGE_LOCAL_DIR)
STORAGE_DIR=${STORAGE_DIR:-./.storage}
[ -n "$PII_BLIND" ] || { echo "Couldn't find PII_BLIND_INDEX_KEY for the live API (process env or .env files under $LIVE_DIR)."; exit 1; }
remote "command -v pg_dump >/dev/null && command -v psql >/dev/null" || { echo "pg_dump/psql aren't installed on the server (apt install postgresql-client)."; exit 1; }

echo "==> [3/6] Backing up local $LOCAL_DB and apps/api/.env to ${BACKUP_DIR}…"
mkdir -p "$BACKUP_DIR"
if psql -X -At -d postgres -c "select 1 from pg_database where datname='$LOCAL_DB'" | grep -q 1; then
  pg_dump --no-owner --no-privileges "$LOCAL_DB" | gzip >"$BACKUP_DIR/$LOCAL_DB-before-sync-$STAMP.sql.gz"
fi
cp "$LOCAL_ENV" "$BACKUP_DIR/api.env-before-sync-$STAMP"

echo "==> [4/6] Dumping the live database…"
# The URL is resolved and used on the server only; Prisma-only query params (connection_limit,
# schema, pgbouncer…) are dropped because pg_dump rejects them.
on_server >"$WORK/live.sql.gz" <<'CMD'
set -eo pipefail
U=$(resolve DATABASE_URL)
[ -n "$U" ] || { echo "No DATABASE_URL found for the live API." >&2; exit 1; }
U=$(U="$U" node -e '
  const x = new URL(process.env.U);
  const keep = new Set(["sslmode", "sslrootcert", "sslcert", "sslkey", "connect_timeout", "target_session_attrs"]);
  for (const k of [...x.searchParams.keys()]) if (!keep.has(k)) x.searchParams.delete(k);
  process.stdout.write(x.toString())')
DB=$(U="$U" node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.U).pathname.slice(1)) || "postgres")')
cd /tmp   # the postgres account can't read /root
as_postgres() { if command -v runuser >/dev/null; then runuser -u postgres -- "$@"; else sudo -u postgres "$@"; fi; }
PG=$(docker ps --format '{{.ID}} {{.Ports}}' 2>/dev/null | grep -E ':5432->' | head -1 | cut -d' ' -f1 || true)

# 1) the API's own URL; 2) the local postgres superuser (peer login, no password);
# 3) a Postgres Docker container publishing 5432. First one that connects is used.
if psql -X -At --dbname="$U" -c 'select 1' >/dev/null 2>/tmp/fl-sync-err; then
  echo "    Connecting with the API's DATABASE_URL" >&2
  pg_dump --no-owner --no-privileges --dbname="$U" | gzip
elif id postgres >/dev/null 2>&1 && as_postgres psql -X -At -d "$DB" -c 'select 1' >/dev/null 2>&1; then
  echo "    The API's password was rejected ($(head -1 /tmp/fl-sync-err | sed 's/.*FATAL: *//')); dumping \"$DB\" as the postgres system user instead" >&2
  as_postgres pg_dump --no-owner --no-privileges -d "$DB" | gzip
elif [ -n "$PG" ] && docker exec "$PG" sh -c 'psql -U "${POSTGRES_USER:-postgres}" -d "$1" -XAt -c "select 1"' sh "$DB" >/dev/null 2>&1; then
  echo "    Dumping \"$DB\" from Docker container $PG" >&2
  docker exec "$PG" sh -c 'pg_dump -U "${POSTGRES_USER:-postgres}" --no-owner --no-privileges -d "$1"' sh "$DB" | gzip
else
  echo "    Couldn't connect to the live database \"$DB\":" >&2
  sed 's/^/      /' /tmp/fl-sync-err >&2
  rm -f /tmp/fl-sync-err
  exit 1
fi
rm -f /tmp/fl-sync-err
CMD
gzip -t "$WORK/live.sql.gz"
gunzip -c "$WORK/live.sql.gz" | tail -5 | grep -q 'database dump complete' || { echo "The live dump is incomplete; nothing was restored."; exit 1; }
cp "$WORK/live.sql.gz" "$BACKUP_DIR/live-$STAMP.sql.gz"

echo "==> [5/6] Restoring into local ${LOCAL_DB}…"
dropdb --if-exists --force "$LOCAL_DB"
createdb "$LOCAL_DB"
# transaction_timeout exists only in PostgreSQL 17+; harmless to drop for a 16 server.
gunzip -c "$WORK/live.sql.gz" | grep -v '^SET transaction_timeout' | psql -X -q -v ON_ERROR_STOP=1 -d "$LOCAL_DB" >/dev/null
echo "    users: $(psql -X -At -d "$LOCAL_DB" -c 'select count(*) from users')   jobs: $(psql -X -At -d "$LOCAL_DB" -c 'select count(*) from jobs')"

echo "==> [6/6] Copying uploaded files and PII keys…"
case "$STORAGE_DIR" in /*) REMOTE_STORAGE="$STORAGE_DIR" ;; *) REMOTE_STORAGE="$LIVE_DIR/apps/api/${STORAGE_DIR#./}" ;; esac
if remote "test -d '$REMOTE_STORAGE'"; then
  mkdir -p "$ROOT/apps/api/.storage"
  rsync -a --delete -e "ssh -S $SOCK" "$LIVE_SSH:$REMOTE_STORAGE/" "$ROOT/apps/api/.storage/"
else
  echo "    No upload folder at $REMOTE_STORAGE on the server; skipped."
fi
# Emails and phones are encrypted with these keys, so local must use the live ones.
set_env() {
  local key=$1 val=$2
  [ -n "$val" ] || return 0
  KEY="$key" VAL="$val" perl -i -pe '$_ = "$ENV{KEY}=$ENV{VAL}\n" if /^\Q$ENV{KEY}\E=/' "$LOCAL_ENV"
  grep -q "^$key=" "$LOCAL_ENV" || printf '%s=%s\n' "$key" "$val" >>"$LOCAL_ENV"
}
set_env PII_LOCAL_MASTER_KEY "$PII_MASTER"
set_env PII_BLIND_INDEX_KEY "$PII_BLIND"
set_env PII_KEY_VERSION "$PII_VER"

# A running `pnpm dev` API reloads when a source file changes; this makes it pick up the new keys.
touch "$ROOT/apps/api/src/main.ts"

echo
echo "Done. Localhost now has the live data. Backups: $BACKUP_DIR"
echo "If the API isn't running under 'pnpm dev', restart it so it loads the new keys."
