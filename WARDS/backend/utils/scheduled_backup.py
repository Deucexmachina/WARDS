"""Scheduled backup runner for WARDS.

Runs as a background daemon thread on VM1. Periodically checks the
backup_schedule setting (stored on VM2 when SECURITY_API_URL is configured)
and executes a full system backup when the next_run time has passed.
"""

from __future__ import annotations

import json
import os
import threading
import time
from datetime import datetime, timedelta


def start_scheduled_backup_runner():
    """Start the background thread that runs scheduled backups."""
    thread = threading.Thread(
        target=_scheduled_backup_loop,
        daemon=True,
        name="wards-scheduled-backup",
    )
    thread.start()
    print("[SCHEDULED BACKUP] runner started; checking every 60 seconds")


def _scheduled_backup_loop():
    from database.models import SessionLocal, Backup, ActivityLog
    from utils.backup_engine import create_database_backup as create_vm1_database_backup
    from utils.security_client import get_setting, set_setting, create_full_system_backup

    _running = False

    while True:
        time.sleep(60)

        try:
            schedule_raw = get_setting(None, "backup_schedule", "{}")
            schedule = json.loads(schedule_raw) if isinstance(schedule_raw, str) else (schedule_raw or {})
        except Exception as exc:
            print(f"[SCHEDULED BACKUP] failed to read schedule: {exc}")
            continue

        if not schedule.get("enabled"):
            continue

        next_run_str = schedule.get("next_run", "")
        if not next_run_str:
            continue

        try:
            next_run = datetime.fromisoformat(next_run_str)
        except Exception:
            print(f"[SCHEDULED BACKUP] invalid next_run format: {next_run_str}")
            continue

        if datetime.now() < next_run:
            continue

        if _running:
            print("[SCHEDULED BACKUP] previous run still in progress; skipping this cycle")
            continue

        _running = True
        print(f"[SCHEDULED BACKUP] executing scheduled full backup (next_run was {next_run_str})")

        vm1_result = None
        vm2_event = None
        vm1_error = None
        vm2_error = None
        db = SessionLocal()
        try:
            # VM1 database backup
            try:
                vm1_result = create_vm1_database_backup()
                print(f"[SCHEDULED BACKUP] VM1 DB backup created: {vm1_result.filename}")
            except Exception as exc:
                vm1_error = str(exc)
                print(f"[SCHEDULED BACKUP] VM1 DB backup failed: {exc}")

            # VM2 full system backup
            try:
                vm2_event = create_full_system_backup(db, None)
                print(f"[SCHEDULED BACKUP] VM2 full backup status: {vm2_event.status if hasattr(vm2_event, 'status') else 'unknown'}")
            except Exception as exc:
                vm2_error = str(exc)
                print(f"[SCHEDULED BACKUP] VM2 full backup failed: {exc}")

            # Record VM1 backup in local DB
            if vm1_result:
                backup = Backup(
                    filename=vm1_result.filename,
                    size=str(vm1_result.size_bytes),
                    type="Scheduled",
                    status="Completed",
                    checksum=vm1_result.checksum,
                    db_type=vm1_result.db_type,
                    retention_days=30,
                )
                db.add(backup)

            action = "Scheduled Full System Backup"
            details = (
                f"Scheduled backup executed. "
                f"VM1: {'ok' if vm1_result else ('failed: ' + vm1_error if vm1_error else 'skipped')}. "
                f"VM2: {'ok' if vm2_event and getattr(vm2_event, 'status', None) == 'success' else ('failed: ' + vm2_error if vm2_error else 'skipped')}."
            )
            db.add(ActivityLog(
                action=action,
                user="system",
                details=details,
                type="security",
            ))
            db.commit()

            # Calculate next run
            frequency = schedule.get("frequency", "weekly")
            if frequency == "daily":
                delta = timedelta(days=1)
            elif frequency == "monthly":
                delta = timedelta(days=30)
            else:
                delta = timedelta(weeks=1)

            new_next_run = (next_run + delta).isoformat()
            new_schedule = {
                "enabled": True,
                "frequency": frequency,
                "next_run": new_next_run,
            }
            try:
                set_setting(db, "backup_schedule", json.dumps(new_schedule), "scheduled_backup_runner")
                print(f"[SCHEDULED BACKUP] next run set to {new_next_run}")
            except Exception as exc:
                print(f"[SCHEDULED BACKUP] failed to update schedule: {exc}")

        except Exception as exc:
            print(f"[SCHEDULED BACKUP] unexpected error during execution: {exc}")
        finally:
            _running = False
            try:
                db.close()
            except Exception:
                pass
