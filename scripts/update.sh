#!/usr/bin/env bash
#
# NodePanel — update in-place (git pull → build → migrate → restart).
# Jalankan dengan: sudo ./scripts/update.sh
#
set -euo pipefail

PANEL_DIR="${PANEL_DIR:-/opt/nodepanel}"
PANEL_USER="nodepanel"
BRANCH="${BRANCH:-main}"

log()  { printf '\033[1;34m[nodepanel]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Jalankan dengan sudo: sudo ./scripts/update.sh"
[[ -d "$PANEL_DIR/.git" ]] || fail "$PANEL_DIR bukan clone git."

log "Menarik perubahan terbaru (branch $BRANCH)..."
git -C "$PANEL_DIR" fetch --prune origin
git -C "$PANEL_DIR" checkout "$BRANCH"
git -C "$PANEL_DIR" pull --ff-only origin "$BRANCH"
chown -R "$PANEL_USER":"$PANEL_USER" "$PANEL_DIR"

log "Backup database sebelum migrasi..."
DB_URL=$(grep '^DATABASE_URL=' "$PANEL_DIR/backend/.env" | cut -d= -f2-)
if [[ -n "$DB_URL" ]]; then
  mkdir -p "$PANEL_DIR/backups"
  mysqldump --single-transaction --routines --triggers "${DB_URL#*//}" \
    | gzip > "$PANEL_DIR/backups/nodepanel-$(date +%Y%m%d-%H%M%S).sql.gz"
  log "Backup tersimpan di $PANEL_DIR/backups/"
fi

log "Update dependensi & build frontend..."
sudo -u "$PANEL_USER" bash -lc "cd $PANEL_DIR/backend  && npm install --no-audit --no-fund && npx prisma migrate deploy"
sudo -u "$PANEL_USER" bash -lc "cd $PANEL_DIR/frontend && npm install --no-audit --no-fund && npm run build"

log "Restart panel..."
sudo -u "$PANEL_USER" PM2_HOME="/home/$PANEL_USER/.pm2" pm2 restart nodepanel

log "Selesai. Cek: curl -s http://127.0.0.1:2087/api/health"
