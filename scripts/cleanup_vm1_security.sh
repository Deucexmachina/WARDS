#!/usr/bin/env bash
# cleanup_vm1_security.sh
# Run this on VM 1 (Application Server) AFTER VM 2 is fully provisioned,
# the Security API is healthy, and you have confirmed data migration succeeded.
#
# NOTE: We CANNOT delete the SECURITY/ folder entirely during Phase 2-6 because
# security_dashboard.py still imports SECURITY.security_models at module load time.
# This script removes data directories and QUARANTINE, but keeps SECURITY/*.py files.
# A future Phase 8 will fully decouple models and allow complete removal.
#
# WARNING: This is destructive. Make sure VM 2 has your security data first.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/wards/app}"
BACKUP_DIR="${BACKUP_DIR:-/opt/wards/backups}"
DROP_SECURITY_TABLES="${DROP_SECURITY_TABLES:-false}"

cd "$APP_DIR"

echo "=== WARDS VM 1 Security Data Cleanup ==="
echo "App directory: $APP_DIR"
echo "Backup directory: $BACKUP_DIR"
echo "Drop security tables: $DROP_SECURITY_TABLES"
echo ""

# ---------------------------------------------------------------------------
# 1. Stop the backend so it does not try to access data while we delete it
# ---------------------------------------------------------------------------
echo "[1/7] Stopping backend service..."
docker compose stop backend || true

# ---------------------------------------------------------------------------
# 2. Backup data directories one last time
# ---------------------------------------------------------------------------
echo "[2/7] Creating final local backup of SECURITY data and QUARANTINE..."
mkdir -p "$BACKUP_DIR"
BACKUP_NAME="$BACKUP_DIR/security_quarantine_final_vm1_$(date +%Y%m%d_%H%M%S).tar.gz"
tar czf "$BACKUP_NAME" \
  SECURITY/local_backups/ \
  SECURITY/ml/ \
  SECURITY/monitoring/ \
  SECURITY/wazuh/ \
  SECURITY/database_monitor/ \
  QUARANTINE/ 2>/dev/null || true
echo "Backup saved to $BACKUP_NAME"

# ---------------------------------------------------------------------------
# 3. Remove QUARANTINE entirely (moved to VM 2)
# ---------------------------------------------------------------------------
echo "[3/7] Removing QUARANTINE/ folder from VM 1..."
rm -rf QUARANTINE/
echo "Removed."

# ---------------------------------------------------------------------------
# 4. Remove SECURITY data subdirectories but KEEP Python source files
# ---------------------------------------------------------------------------
echo "[4/7] Removing SECURITY data directories (keeping .py source files)..."
rm -rf SECURITY/local_backups/ 2>/dev/null || true
rm -rf SECURITY/ml/ 2>/dev/null || true
rm -rf SECURITY/monitoring/ 2>/dev/null || true
rm -rf SECURITY/wazuh/ 2>/dev/null || true
rm -rf SECURITY/database_monitor/ 2>/dev/null || true
# Keep: SECURITY/*.py files (security_engine.py, security_models.py, etc.)
echo "SECURITY data removed. Python files preserved for dashboard imports."

# ---------------------------------------------------------------------------
# 5. Remove temporary read-only SECURITY mount from docker-compose.yml
# ---------------------------------------------------------------------------
echo "[5/7] Removing temporary SECURITY mount from docker-compose.yml..."
if grep -q './SECURITY:/SECURITY:ro' docker-compose.yml; then
    # Use sed to comment out the temporary mount block
    sed -i '/TEMPORARY (Phase 2-6)/,/\/SECURITY:ro/{ /- \/SECURITY/d; }' docker-compose.yml || true
    sed -i '/TEMPORARY (Phase 2-6)/d' docker-compose.yml || true
    echo "Removed temporary mount."
else
    echo "No temporary mount found — skipping."
fi

# ---------------------------------------------------------------------------
# 6. Rebuild backend without SECURITY data
# ---------------------------------------------------------------------------
echo "[6/7] Rebuilding backend..."
docker compose up -d --build backend

# ---------------------------------------------------------------------------
# 7. Update Wazuh agent config to remove SECURITY from FIM
# ---------------------------------------------------------------------------
echo "[7/7] Updating Wazuh FIM configuration..."
WAZUH_CONF="/var/ossec/etc/ossec.conf"
if [ -f "$WAZUH_CONF" ]; then
    sed -i '/\/opt\/wards\/app\/SECURITY/d' "$WAZUH_CONF" || true
    echo "Removed SECURITY paths from $WAZUH_CONF"
    echo "Restarting Wazuh agent..."
    systemctl restart wazuh-agent || true
else
    echo "Wazuh config not found at $WAZUH_CONF — skipping."
fi

# ---------------------------------------------------------------------------
# 8. Optionally drop security tables from VM 1 MySQL
# ---------------------------------------------------------------------------
if [ "$DROP_SECURITY_TABLES" = "true" ]; then
    echo "[8/8] Dropping security tables from VM 1 database..."
    docker compose exec mysql mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" wards_db -e "
        DROP TABLE IF EXISTS security_incidents;
        DROP TABLE IF EXISTS security_detection_events;
        DROP TABLE IF EXISTS security_recovery_events;
        DROP TABLE IF EXISTS security_admin_file_changes;
        DROP TABLE IF EXISTS security_monitored_files;
        DROP TABLE IF EXISTS security_settings;
    " || echo "Warning: could not drop tables. Check MySQL root password."
    echo "Security tables dropped."
else
    echo "[8/8] Skipping table drop (set DROP_SECURITY_TABLES=true to enable)."
    echo "Security tables still exist on VM 1. You can drop them later."
fi

echo ""
echo "=== VM 1 Security data cleanup complete ==="
echo ""
echo "What was removed:"
echo "  - QUARANTINE/ (entire folder moved to VM 2)"
echo "  - SECURITY/local_backups, ml, monitoring, wazuh, database_monitor"
echo "What was preserved:"
echo "  - SECURITY/*.py files (needed by security_dashboard.py during transition)"
echo ""
echo "Next steps:"
echo "  1. Verify backend health:  curl http://localhost:8000/api/health"
echo "  2. Verify security dashboard loads via VM 2 proxy."
echo "  3. Delete the backup after 7 days if all is well:"
echo "     rm $BACKUP_DIR/security_quarantine_final_vm1_*.tar.gz"
echo "  4. A future Phase 8 will fully remove SECURITY/*.py once model imports are decoupled."
