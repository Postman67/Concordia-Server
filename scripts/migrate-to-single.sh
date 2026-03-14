#!/bin/bash
# migrate-to-single.sh
# Migrates an existing two-container Concordia stack (docker-compose.yml) to
# the single-container stack (docker-compose.single.yml).
#
# Usage: bash scripts/migrate-to-single.sh [--yes]
#   --yes   Skip the confirmation prompt (useful for automation)
#
# What it does:
#   1. Dumps the Postgres database from the running two-container stack
#   2. Starts the single-container stack (fresh DB is auto-provisioned)
#   3. Restores the dump into the new container
#   4. Copies media files across to the new volume
#   5. Prints a verification summary
#
# The old stack is left stopped (not removed) so you can roll back if needed.
# Old volumes (postgres_data, media_data) are NOT deleted by this script.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_FILE="$PROJECT_DIR/concordia_backup_$(date +%Y%m%d_%H%M%S).sql"

# ── Colours ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${GREEN}[migrate]${NC} $*"; }
warn()    { echo -e "${YELLOW}[migrate]${NC} $*"; }
fatal()   { echo -e "${RED}[migrate] ERROR:${NC} $*" >&2; exit 1; }

# ── Preflight checks ──────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || fatal "docker is not installed"
docker compose version >/dev/null 2>&1 || fatal "docker compose (v2) is not installed"

cd "$PROJECT_DIR"

[ -f docker-compose.yml ]        || fatal "docker-compose.yml not found (run from project root)"
[ -f docker-compose.single.yml ] || fatal "docker-compose.single.yml not found"

# ── Confirm ───────────────────────────────────────────────────────────────────
if [[ "${1:-}" != "--yes" ]]; then
  warn "This will:"
  warn "  • Stop the two-container stack (postgres_data + media_data kept)"
  warn "  • Start the single-container stack with fresh volumes"
  warn "  • Restore your data into the new stack"
  echo
  read -r -p "Continue? [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] || { warn "Aborted."; exit 0; }
fi

# ── Step 1: Ensure old stack is up so we can dump ─────────────────────────────
info "Step 1/5 — Starting old stack to verify it is reachable..."
docker compose up -d

info "Waiting for Postgres to be ready..."
for i in $(seq 1 30); do
  if docker compose exec -T db pg_isready -U concordia -q 2>/dev/null; then
    break
  fi
  if [ "$i" -eq 30 ]; then
    fatal "Postgres did not become ready in time"
  fi
  sleep 2
done

# ── Step 2: Dump ──────────────────────────────────────────────────────────────
info "Step 2/5 — Dumping database to $BACKUP_FILE..."
docker compose exec -T db pg_dump -U concordia concordia > "$BACKUP_FILE"
DUMP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
info "Dump complete (${DUMP_SIZE})."

# ── Step 3: Stop old stack (keep volumes) ────────────────────────────────────
info "Step 3/5 — Stopping old stack (volumes preserved)..."
docker compose down

# ── Step 4: Start new single-container stack ─────────────────────────────────
info "Step 4/5 — Building and starting single-container stack..."
docker compose -f docker-compose.single.yml up --build -d

info "Waiting for the new container's server to be ready..."
for i in $(seq 1 60); do
  if curl -sf http://localhost:${PORT:-3000}/health >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 60 ]; then
    fatal "New container did not become healthy in time. Check: docker compose -f docker-compose.single.yml logs"
  fi
  sleep 3
done

# ── Step 5: Restore DB + copy media ──────────────────────────────────────────
info "Step 5/5 — Restoring database..."
# Drop and recreate the public schema to get a clean slate before restoring
docker compose -f docker-compose.single.yml exec -T concordia \
  su-exec postgres psql -U concordia -d concordia \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO concordia;"

docker compose -f docker-compose.single.yml exec -T concordia \
  su-exec postgres psql -U concordia -d concordia < "$BACKUP_FILE"

info "Copying media files..."
# Resolve compose project name to find the correct volume names
PROJECT_NAME="$(basename "$PROJECT_DIR" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')"
OLD_MEDIA_VOL="${PROJECT_NAME}_media_data"
NEW_MEDIA_VOL="${PROJECT_NAME}_concordia_media"

if docker volume inspect "$OLD_MEDIA_VOL" >/dev/null 2>&1; then
  docker run --rm \
    -v "${OLD_MEDIA_VOL}:/from:ro" \
    -v "${NEW_MEDIA_VOL}:/to" \
    alpine sh -c "cp -a /from/. /to/ && echo 'Media copied.'"
else
  warn "Old media volume '${OLD_MEDIA_VOL}' not found — skipping media copy (normal if no files were uploaded)."
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo
info "Migration complete."
info "  New stack:    docker compose -f docker-compose.single.yml ..."
info "  Backup kept:  $BACKUP_FILE"
info "  Old volumes (postgres_data, media_data) are untouched — remove manually when satisfied:"
echo
echo "    docker volume rm ${PROJECT_NAME}_postgres_data ${PROJECT_NAME}_media_data"
echo
info "  To roll back: docker compose -f docker-compose.single.yml down"
info "                docker compose up -d"
