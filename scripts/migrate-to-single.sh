#!/bin/bash
# migrate-to-single.sh
# Migrates an existing two-container Concordia stack (docker-compose.yml) to
# a single standalone container named "Concordia-Server".
#
# Usage: bash scripts/migrate-to-single.sh [--yes]
#   --yes   Skip the confirmation prompt (useful for automation)
#
# What it does:
#   1. Dumps the Postgres database from the running two-container stack
#   2. Builds the single-container image (Dockerfile.single)
#   3. Starts a standalone container named "Concordia-Server"
#   4. Restores the dump into the new container
#   5. Copies media files across to the new volume
#
# The old stack is left stopped (not removed) so you can roll back if needed.
# Old volumes (postgres_data, media_data) are NOT deleted by this script.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_FILE="$PROJECT_DIR/concordia_backup_$(date +%Y%m%d_%H%M%S).sql"
CONTAINER_NAME="Concordia-Server"
IMAGE_NAME="concordia-server"
DB_VOL="concordia_db"
MEDIA_VOL="concordia_media"

# ── Colours ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${GREEN}[migrate]${NC} $*"; }
warn()    { echo -e "${YELLOW}[migrate]${NC} $*"; }
fatal()   { echo -e "${RED}[migrate] ERROR:${NC} $*" >&2; exit 1; }

# ── Preflight checks ──────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1   || fatal "docker is not installed"
docker compose version >/dev/null 2>&1 || fatal "docker compose (v2) is not installed"

cd "$PROJECT_DIR"

[ -f docker-compose.yml ]   || fatal "docker-compose.yml not found (run from project root)"
[ -f Dockerfile.single ]    || fatal "Dockerfile.single not found"

# ── Load .env for PORT / ADMIN_USER_ID / etc. (optional) ─────────────────────
# Values are only used when launching the new container; the old stack reads
# its own .env via docker compose.
PORT="${PORT:-3000}"
ADMIN_USER_ID="${ADMIN_USER_ID:-0}"
FEDERATION_URL="${FEDERATION_URL:-https://federation.concordiachat.com}"
CLIENT_ORIGIN="${CLIENT_ORIGIN:-*}"
if [ -f "$PROJECT_DIR/.env" ]; then
  # shellcheck disable=SC1091
  set -a; source "$PROJECT_DIR/.env"; set +a
fi

# ── Confirm ───────────────────────────────────────────────────────────────────
if [[ "${1:-}" != "--yes" ]]; then
  warn "This will:"
  warn "  • Stop the two-container stack (its volumes are kept)"
  warn "  • Build image '$IMAGE_NAME' from Dockerfile.single"
  warn "  • Start a standalone container named '$CONTAINER_NAME'"
  warn "  • Restore your data into the new container"
  echo
  read -r -p "Continue? [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] || { warn "Aborted."; exit 0; }
fi

# ── Step 1: Ensure old stack is up so we can dump ────────────────────────────
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

# ── Step 3: Stop old stack + build new image ──────────────────────────────────
info "Step 3/5 — Stopping old stack (volumes preserved)..."
docker compose down

info "Building image '$IMAGE_NAME' from Dockerfile.single..."
docker build -f Dockerfile.single -t "$IMAGE_NAME" .

# Remove any pre-existing container with the same name
if docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  warn "Container '$CONTAINER_NAME' already exists — removing it..."
  docker rm -f "$CONTAINER_NAME"
fi

# Create named volumes explicitly so they are identifiable
docker volume create "$DB_VOL"    >/dev/null
docker volume create "$MEDIA_VOL" >/dev/null

info "Starting container '$CONTAINER_NAME'..."
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -p "${PORT}:3000" \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e HOST=0.0.0.0 \
  -e DB_HOST=localhost \
  -e DB_PORT=5432 \
  -e DB_NAME=concordia \
  -e DB_USER=concordia \
  -e FEDERATION_URL="$FEDERATION_URL" \
  -e ADMIN_USER_ID="$ADMIN_USER_ID" \
  -e CLIENT_ORIGIN="$CLIENT_ORIGIN" \
  -e MEDIA_PATH=/data/media \
  -v "${DB_VOL}:/var/lib/postgresql/data" \
  -v "${MEDIA_VOL}:/data/media" \
  "$IMAGE_NAME"

# ── Step 4: Wait for server to be healthy ─────────────────────────────────────
info "Step 4/5 — Waiting for '$CONTAINER_NAME' to be ready..."
for i in $(seq 1 60); do
  if curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 60 ]; then
    fatal "Container did not become healthy in time. Check: docker logs $CONTAINER_NAME"
  fi
  sleep 3
done

# ── Step 5: Restore DB + copy media ──────────────────────────────────────────
info "Step 5/5 — Restoring database..."
docker exec -i "$CONTAINER_NAME" \
  su-exec postgres psql -U concordia -d concordia \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO concordia;"

docker exec -i "$CONTAINER_NAME" \
  su-exec postgres psql -U concordia -d concordia < "$BACKUP_FILE"

info "Copying media files..."
PROJECT_NAME="$(basename "$PROJECT_DIR" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')"
OLD_MEDIA_VOL="${PROJECT_NAME}_media_data"

if docker volume inspect "$OLD_MEDIA_VOL" >/dev/null 2>&1; then
  docker run --rm \
    -v "${OLD_MEDIA_VOL}:/from:ro" \
    -v "${MEDIA_VOL}:/to" \
    alpine sh -c "cp -a /from/. /to/ && echo 'Media copied.'"
else
  warn "Old media volume '${OLD_MEDIA_VOL}' not found — skipping (normal if no files were uploaded)."
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo
info "Migration complete."
info "  Container:  $CONTAINER_NAME  (docker start/stop/logs $CONTAINER_NAME)"
info "  Image:      $IMAGE_NAME"
info "  Volumes:    $DB_VOL  |  $MEDIA_VOL"
info "  Backup:     $BACKUP_FILE"
echo
warn "Old volumes are untouched. Remove them manually once you are satisfied:"
echo "  docker volume rm ${PROJECT_NAME}_postgres_data ${PROJECT_NAME}_media_data"
echo
warn "To roll back:"
echo "  docker stop $CONTAINER_NAME"
echo "  docker compose up -d"

