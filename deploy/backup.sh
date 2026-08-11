#!/usr/bin/env bash
## Nightly SQLite backup for InfyTrack.
##
## Install as a cron job (as the infytrack user, or root with the path
## adjusted):
##   crontab -e
##   0 3 * * * /opt/infytrack/deploy/backup.sh
##
## Uses SQLite's own backup command (via sqlite3) rather than `cp`, so it
## can safely run against a live database in WAL mode without corrupting
## a copy mid-write.

set -euo pipefail

DATA_DIR="${DATA_DIR:-/opt/infytrack/server/data}"
BACKUP_DIR="${BACKUP_DIR:-/opt/infytrack/backups}"
DB_FILE="${DB_FILE:-$DATA_DIR/infytrack.db}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"
sqlite3 "$DB_FILE" ".backup '$BACKUP_DIR/infytrack-$STAMP.db'"

# Keep the last 14 days, delete older backups.
find "$BACKUP_DIR" -name 'infytrack-*.db' -mtime +14 -delete
