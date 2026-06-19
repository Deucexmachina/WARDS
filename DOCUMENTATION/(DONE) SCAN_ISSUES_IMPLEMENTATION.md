# WARDS Security Scan Performance Implementation Guide

> **Version:** 1.0  
> **Last Updated:** 2026-06-16  
> **Status:** Performance Hardening — Pre-Deployment  
> **Constraint:** All changes must be backward-compatible. Do not break existing unified auth, MFA, payment flows, branch portal functions, file-integrity monitoring, or backup/recovery operations.

---

## How to Use This File

Each section contains:
1. **What it is** — the bottleneck and the fix
2. **Current progress** — verified state from code review
3. **Implementation steps** — safe, incremental changes with file paths
4. **Safety rules** — what must not change or regress
5. **Verification** — how to confirm it works

> **CRITICAL:** Before modifying any security engine logic, run the test suite and confirm all tests pass.

```powershell
$env:PYTHONPATH="C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend"
& "c:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Scripts\python.exe" -m pytest tests -v --tb=short
```

---

# Summary

| Fix | Effort | Impact | Progress |
|---|---|---|---|
| A. mtime/size fast-path for file scans | Small | Very High | `0/3` — Not started |
| B. Skip DB manifest when no audit changes | Small | Very High | `0/3` — Not started |
| F. Configurable/adaptive scan interval | Small | High | `0/2` — Not started |
| C. Incremental `register_initial_files` | Medium | High | `0/4` — Not started |
| E. Batch DB updates in `scan_all_files` | Medium | Moderate | `0/3` — Not started |
| D. Parallel file hashing | Medium-High | Moderate-High | `0/4` — Not started |

---

# Architectural Context: File vs. Database Separation

> **Source:** `DEV_ISSUES_IMPLEMENTATION.md` §1.1 — *Real Database Backup & Restore*  
> This section is a prerequisite for all scan performance work below.

Scans, backups, and recovery for **files** (WARDS / OCR folders) and the **database** (MySQL dumps) are now fully separate systems. This separation is enforced at every layer: storage paths, engine functions, API endpoints, scheduled jobs, and dashboard controls.

## Storage Separation

```text
local_backups/
├── database/          # MySQL/PostgreSQL dumps only
├── wards/             # WARDS source files only
└── ocr/               # OCR files only
```

Database dumps must never be mixed into WARDS or OCR backup archives, and file-system restore operations must never modify the database.

## Control Separation

Every dashboard tab and manual control must expose **independent** file and database operations. The layout should be:

| Control | Mode |
|---|---|
| **File Backups** | Separate — own schedule, path, retention |
| **Database Backups** | Separate — own schedule, path, retention |
| **File Scans** | Separate — own interval, trigger, and status |
| **Database Scans** | Separate — own interval, trigger, and status |
| **Full Security Scan** | **Combined convenience button** — runs the file scan and database scan back-to-back using their respective engines |

## What "Separate" Means

- **Separate scan interval:** File scans and database scans each have their own `scan_interval_seconds` setting. Changing one does not affect the other.
- **Separate schedule menu:** Scheduled backups and scheduled scans have distinct enable/disable toggles and frequency pickers for files vs. database.
- **Separate scan button:** A "Scan WARDS / OCR Files" button and a "Scan Database Integrity" button.
- **Separate recovery button:** Restoring a file backup only touches files. Restoring a database backup only runs `mysql`/`psql`. They are never chained together.

## System Health Tab

The health / status tab must report file integrity and database integrity as two distinct cards:

- **File Integrity:** last file scan time, files monitored, changes detected, incidents.
- **Database Integrity:** last database scan time, manifest hash, audit changes since last scan, unauthorized changes.
- **Overall Status:** aggregate of both (e.g., "Healthy" only if both are clean).

## Combined Convenience Button

The **Full Security Scan** button is a thin orchestrator:

1. Trigger `scan_all_files(db, context={"full_scan": True})` for the file tree.
2. Trigger `scan_database_entry(db, database_entry, context={"full_scan": True})` for the database.
3. Return a unified result object containing both sub-results.

It does **not** merge the two domains into a single hash or a single backup archive.

---

# PHASE 1: QUICK WINS — Highest Return for Smallest Change

---

## A. mtime/size Fast-Path for File Scans

**What:** Currently `scan_single_file` in `security_engine.py` calls `sha256_file(path)` on every monitored file during every scan, even if the file has not changed. Adding an `mtime` + `size` comparison before hashing avoids reading unchanged files from disk entirely.

**Current Progress:** `0/3` — No fast-path exists. `scan_single_file` always hashes.

### Implementation Steps

1. **Modify `scan_single_file`** in `SECURITY/security_engine.py` (around line 3200):
   - Before calling `sha256_file(path)`, fetch `path.stat()`.
   - If `file_entry.size_bytes == stat.st_size` **and** `file_entry.last_checked >= datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)`, skip hashing.
   - Mark the entry as `clean`, update `last_checked`, `db.add()`, and return `None`.

2. **Update `register_initial_files`** in `SECURITY/security_engine.py` (around line 2035):
   - Store `st_mtime` from `path.stat()` into `last_checked` (or add a new column `last_mtime`) during registration so the fast-path is valid from the first scan.

3. **(Optional) Add `last_mtime` column** to `SecurityMonitoredFile` in `WARDS/backend/database/models.py`:
   - This makes the check more robust than using `last_checked`, which may drift from the actual file mtime.

### Safety Rules

- Do **not** remove `sha256_file` calls for files that fail the mtime/size check.
- Do **not** change the `SecurityDetectionEvent` schema or incident creation logic.
- Do **not** modify `unified_auth.py`, MFA routes, or payment flows.
- Ensure `last_checked` is timezone-aware before comparing to `st_mtime`.

### Verification

- Run a manual scan twice. The second scan should complete significantly faster.
- Temporarily touch a monitored file. Confirm the next scan detects the change.
- Confirm all existing tests pass.

---

## B. Skip Database Manifest Generation When No Audit Changes

**What:** `scan_database_entry` regenerates the full database checksum manifest on every scan. This queries every monitored table, serializes every row, and hashes the result — the most expensive operation in the engine. The manifest only needs regeneration when the audit log reports actual database changes.

**Current Progress:** `0/3` — Manifest is always generated. Audit log is checked afterward.

### Implementation Steps

1. **Restructure `scan_database_entry`** in `SECURITY/security_engine.py` (around line 3134):
   - Query `database_audit_changes_since` **first**.
   - If both `audit_changes` and `unauthorized_audit_changes` are empty, skip `create_database_checksum_manifest`.
   - Instead, reuse the existing manifest file on disk: verify it exists, hash it, compare to `baseline_hash`. If clean, return `None`.
   - Only regenerate the manifest when `audit_changes` is non-empty.

2. **Cache the manifest hash** in `security_settings` (optional):
   - Store `database_manifest_hash` and `database_manifest_generated_at` in `security_settings`.
   - On clean scans, compare the cached hash to `baseline_hash` without even reading the manifest file.

3. **Ensure baseline refresh still works**:
   - When `audit_changes` exists but `unauthorized_audit_changes` does not, refresh the backup snapshot and update the baseline (existing behavior must remain).

### Safety Rules

- Do **not** skip the manifest if `unauthorized_audit_changes` is non-empty.
- Do **not** change the database snapshot (`create_database_snapshot`) or restore logic.
- Do **not** remove `database_audit_changes_since` queries.
- Keep the existing `backup_source` / `old_content` recovery path untouched.

### Verification

- Run `scan_all_files` twice on a idle database. The second scan should skip manifest generation.
- Insert a row into a monitored table. Confirm the next scan regenerates the manifest and detects the change.
- Verify unauthorized changes still trigger detections and auto-recovery.

---

## F. Configurable / Adaptive Scan Interval

**What:** The background monitor loop runs every 30 seconds by default (`SECURITY_SCAN_INTERVAL_SECONDS`). For large deployments this is too aggressive and wastes CPU. The interval should be configurable via env var / settings, and ideally adaptive (shorter after a detection, longer during idle periods).

**Current Progress:** `0/2` — Env var exists but default is hard-coded to 30s and not adaptive.

### Implementation Steps

1. **Make the interval configurable via settings** in `WARDS/backend/main.py` (around line 1619):
   - Read `scan_interval_seconds` from `security_settings` at runtime.
   - Keep `max(5, interval)` as a floor.

2. **(Optional) Add adaptive logic** in the monitor loop:
   - If the last scan found detections, set interval to `min(30, configured_interval)`.
   - If the last N scans (e.g., 5) were clean, double the interval up to a ceiling (e.g., 300 seconds).
   - Reset to base interval immediately after any detection.

3. **Expose the interval in the security dashboard**:
   - The dashboard already reads `scan_interval_seconds` for display. Ensure it can also write it back to `security_settings`.

### Safety Rules

- Do **not** set the floor below 5 seconds.
- Do **not** disable monitoring entirely by raising the interval.
- Do **not** change the startup baseline backup behavior.

### Verification

- Change `scan_interval_seconds` to `300` in settings. Confirm the monitor loop respects it.
- Trigger a detection. Confirm the interval drops back to the base value.

---

# PHASE 2: MEDIUM EFFORT — Structural Improvements

---

## C. Incremental `register_initial_files`

**What:** `scan_all_files` calls `register_initial_files` on every scan, which does a full `os.walk` over WARDS and OCR roots, then queries the DB for every file. On large trees this is unnecessary overhead. Registration should be incremental — only discovering new/deleted files when explicitly needed.

**Current Progress:** `0/4` — Full walk happens every scan. No incremental mode exists.

### Implementation Steps

1. **Add an `incremental` parameter** to `register_initial_files` in `SECURITY/security_engine.py`:
   - `incremental=True`: Skip `os.walk`. Only iterate existing `active_monitored_files_query` rows.
   - `incremental=False`: Run the full walk (existing behavior).

2. **Update `scan_all_files`** to use incremental mode:
   - Call `register_initial_files(db, refresh_existing=False, incremental=True)` during normal background scans.
   - Keep `incremental=False` during scheduled backups and startup baseline backups.

3. **Add a scheduled "full registration" cycle**:
   - Once per hour (or once per `scan_interval * 10`), run a full walk to catch new files that were added outside the app.

4. **Update `iter_monitorable_files`** if needed:
   - Ensure hidden directories and excluded paths are still respected.

### Safety Rules

- Do **not** remove the full walk entirely. It is still needed for initial startup and after backup/restore.
- Do **not** change `MONITORED_ROOTS` or `DEFAULT_EXCLUDED_DIRS`.
- Ensure deleted files are still handled by the `replacement_path_for` / `mark_verified_removal` logic in `scan_all_files`.

### Verification

- Add a new file to the WARDS folder. Confirm it is not detected during an incremental scan but is picked up during the next full registration.
- Delete a monitored file. Confirm the incremental scan still marks it as missing via the existing `scan_single_file` path.
- Confirm scan time drops on large trees between full registrations.

---

## E. Batch DB Updates in `scan_all_files`

**What:** `scan_all_files` iterates over every file entry and calls `db.add()` + `db.flush()` for each clean file. With thousands of files, this creates thousands of SQL round-trips. Batching them into one update reduces DB load.

**Current Progress:** `0/3` — Per-file `db.add()` / `db.flush()` inside `scan_single_file`.

### Implementation Steps

1. **Refactor `scan_all_files`** in `SECURITY/security_engine.py` (around line 3339):
   - Collect all clean `SecurityMonitoredFile` instances into a list.
   - After the loop, call `db.bulk_update_mappings()` or `db.add_all(clean_entries)` followed by a single `db.commit()`.

2. **Keep per-file flushes for detections**:
   - When a detection is found, `scan_single_file` should still commit immediately so the detection is persisted before quarantine/incident creation.
   - Only batch the "clean" updates.

3. **Update `scan_database_entry` and `scan_single_file` signatures** (optional):
   - Add a `commit_clean: bool = True` parameter (already exists; ensure `scan_all_files` passes `commit_clean=False` and batches at the end).

### Safety Rules

- Do **not** batch detection events. Detections must be committed immediately.
- Do **not** change the `SecurityMonitoredFile` schema.
- Ensure the `db.commit()` at the end of `scan_all_files` still flushes all clean entries.

### Verification

- Profile a scan with logging enabled. Confirm the number of SQL UPDATE statements drops from N to 1.
- Confirm detections still create incidents and quarantine files immediately.

---

# PHASE 3: HEAVY LIFTS — Parallelization

---

## D. Parallel File Hashing

**What:** SHA-256 hashing is CPU-bound and disk-bound. The current code hashes files sequentially in a single thread. Using `concurrent.futures.ThreadPoolExecutor` can saturate disk I/O and use multiple cores.

**Current Progress:** `0/4` — All file operations are sequential. No threading or multiprocessing is used in `security_engine.py`.

### Implementation Steps

1. **Create a hash worker function** in `SECURITY/security_engine.py`:
   - Accept a `SecurityMonitoredFile` entry.
   - Return `(entry_id, hash, size, exists)`.

2. **Add a parallel hash step inside `scan_all_files`**:
   - Before the per-file detection loop, collect all monitored file paths.
   - Submit them to a `ThreadPoolExecutor(max_workers=8)` (or `os.cpu_count()`).
   - Store results in a dict keyed by `entry.id`.

3. **Update the per-file loop to use precomputed hashes**:
   - Replace the `sha256_file(path)` call inside `scan_single_file` with the cached result.
   - Keep the rest of the logic (detection, content diff, quarantine) unchanged.

4. **Handle errors gracefully**:
   - If a file is deleted between submission and result retrieval, fall back to the existing `FileNotFoundError` handling.

### Safety Rules

- Do **not** run DB operations inside the thread pool. SQLAlchemy sessions are not thread-safe by default.
   - Only hash files in threads. All DB writes must remain in the main thread.
- Do **not** change `scan_single_file`'s detection or AI analysis logic.
- Ensure `ThreadPoolExecutor` is properly shut down with a context manager.
- Do not raise `max_workers` above `os.cpu_count()` to avoid I/O thrashing.

### Verification

- Time a scan before and after on a multi-core machine with >1,000 files. Confirm wall-clock time decreases.
- Confirm detection events still contain correct old/new hashes.
- Confirm quarantine and recovery use the correct file contents.

---

# Cross-Cutting Safety Rules

1. **Do not modify unified auth, MFA, payment, or branch portal code.**
   - Changes are restricted to `SECURITY/security_engine.py`, `WARDS/backend/database/models.py`, and `WARDS/backend/main.py` (monitor loop only).

2. **Do not change detection or incident behavior.**
   - `should_create_incident`, `record_detection`, `ai_predict`, `content_flags`, and `quarantine_file` must behave identically.

3. **Do not change backup or restore logic.**
   - `create_manual_backup`, `restore_from_backup`, and `restore_database_from_backup` must remain untouched except where explicitly noted (adaptive interval only).

4. **Do not change the `SecurityMonitoredFile` schema unless adding `last_mtime`.**
   - Existing columns (`baseline_hash`, `current_hash`, `status`, etc.) must keep their meanings.

5. **Do not remove existing tests.**
   - Add new tests for performance paths. Do not weaken or delete existing assertions.

6. **All env-driven toggles must default to existing behavior.**
   - If a fast-path or adaptive interval can be disabled, the default must preserve current behavior until explicitly configured.

---

# Verification Checklist

After all phases are complete:

- [ ] `pytest tests -v` passes with no regressions.
- [ ] A clean scan on a 1,000+ file tree completes in <5 seconds (vs. current time).
- [ ] A clean database scan skips manifest generation.
- [ ] Touching a single file is still detected on the next scan.
- [ ] Unauthorized DB changes still trigger detection + auto-recovery.
- [ ] Manual backup and restore still function correctly.
- [ ] Security dashboard displays scan interval and last scan time accurately.
