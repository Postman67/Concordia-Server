#!/bin/sh
# Single-container entrypoint — starts PostgreSQL, provisions the DB, then starts Node.
set -e

PGDATA="${PGDATA:-/var/lib/postgresql/data}"

# ── Initialize PostgreSQL data directory ──────────────────────────────────────
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "[postgres] Initializing data directory..."
  su-exec postgres initdb \
    --pgdata="$PGDATA" \
    --auth=trust \
    --locale=C \
    --encoding=UTF8
fi

# ── Start PostgreSQL ──────────────────────────────────────────────────────────
echo "[postgres] Starting..."
su-exec postgres pg_ctl -D "$PGDATA" -l /tmp/postgres.log start -w -t 30

# ── Provision user + database (idempotent) ────────────────────────────────────
echo "[postgres] Provisioning..."

su-exec postgres psql postgres -v ON_ERROR_STOP=1 -c \
  "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'concordia') THEN CREATE USER concordia; END IF; END \$\$;"

su-exec postgres psql postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'concordia'" \
  | grep -q 1 || su-exec postgres createdb -O concordia concordia

echo "[postgres] Ready."

# ── Graceful shutdown handler ─────────────────────────────────────────────────
_shutdown() {
  echo "[entrypoint] Shutting down..."
  kill "$NODE_PID" 2>/dev/null || true
  wait "$NODE_PID" 2>/dev/null || true
  su-exec postgres pg_ctl -D "$PGDATA" stop -m fast 2>/dev/null || true
}
trap _shutdown TERM INT

# ── Start Node server ─────────────────────────────────────────────────────────
echo "[server] Starting..."
node /app/dist/index.js &
NODE_PID=$!
wait "$NODE_PID"
