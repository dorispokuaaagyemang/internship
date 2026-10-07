#!/usr/bin/env sh
# Nightly backup on the VPS (docs/DEPLOYMENT.md): the MySQL database and the SeaweedFS files
# (resumes, certificates). Keeps 7 daily copies and 4 weekly (Sunday) copies, so nothing is older
# than 28 days (privacy/service.js BACKUP_RETENTION_DAYS: erased accounts leave the backups too).
#
# Off-site: set OFFSITE_REMOTE to an rclone remote (e.g. "r2:internship-backups") configured in
# RCLONE_CONFIG_DIR. The copy is a *sync*, so old backups are deleted off-site as well.
#
#   crontab: 30 2 * * * OFFSITE_REMOTE=r2:internship-backups /opt/internship/docker/backup.sh >> /var/log/internship-backup.log 2>&1
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

# Mirror off-site with the same retention: what was deleted above is deleted there too.
if [ -n "${OFFSITE_REMOTE:-}" ]; then
  RCLONE_CONFIG_DIR="${RCLONE_CONFIG_DIR:-/root/.config/rclone}"
  docker run --rm \
    -v "$BACKUP_DIR":/data:ro \
    -v "$RCLONE_CONFIG_DIR":/config/rclone:ro \
    rclone/rclone:1.68 sync /data "$OFFSITE_REMOTE" --delete-after
  echo "[$(date -Is)] mirrored to $OFFSITE_REMOTE"
else
  echo "[$(date -Is)] WARNING: OFFSITE_REMOTE is not set; backups exist only on this server"
fi

echo "[$(date -Is)] backup $STAMP done: $(du -sh "$BACKUP_DIR/daily" | cut -f1) in daily"
