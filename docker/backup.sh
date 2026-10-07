#!/usr/bin/env sh
# Nightly backup on the VPS (docs/DEPLOYMENT.md): the MySQL database and the SeaweedFS files
# (resumes, certificates). Keeps 7 daily copies and 4 weekly (Sunday) copies.
# Copy BACKUP_DIR off the server too (rclone/rsync): a backup on the same disk is not enough.
#
#   crontab: 30 2 * * * /opt/internship/docker/backup.sh >> /var/log/internship-backup.log 2>&1
set -eu

cd "$(dirname "$0")/.."
BACKUP_DIR="${BACKUP_DIR:-/var/backups/internship}"
COMPOSE="docker compose --env-file .env -f docker/docker-compose.yml -f docker/docker-compose.prod.yml"
STAMP="$(date +%Y-%m-%d_%H%M)"

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"
chmod 700 "$BACKUP_DIR"

echo "[$(date -Is)] backup $STAMP starting"

# A consistent snapshot of InnoDB tables without locking the app out.
$COMPOSE exec -T mysql sh -c \
  'exec mysqldump --single-transaction --routines --triggers --no-tablespaces -u root -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
  | gzip > "$BACKUP_DIR/daily/db-$STAMP.sql.gz"

# The object store's data volume (compose project "internship").
docker run --rm \
  -v internship_seaweedfs-data:/data:ro \
  -v "$BACKUP_DIR/daily":/backup \
  alpine tar czf "/backup/files-$STAMP.tar.gz" -C /data .

# Sundays: keep a weekly copy as well.
if [ "$(date +%u)" = "7" ]; then
  cp "$BACKUP_DIR/daily/db-$STAMP.sql.gz" "$BACKUP_DIR/daily/files-$STAMP.tar.gz" "$BACKUP_DIR/weekly/"
fi

find "$BACKUP_DIR/daily" -type f -mtime +7 -delete
find "$BACKUP_DIR/weekly" -type f -mtime +28 -delete

echo "[$(date -Is)] backup $STAMP done: $(du -sh "$BACKUP_DIR/daily" | cut -f1) in daily"
