# WARDS Two-VM Security Separation Implementation

This guide migrates WARDS from a **single VM** (App + Security on one droplet) to a **two-VM architecture** that isolates the security stack from the application stack.

**Why this matters:** If an attacker compromises the app VM, they can currently delete the `SECURITY/` folder, wipe quarantined files, and drop the security audit tables because everything lives on the same disk. Separating the VMs puts the security brain on a different machine (and ideally a different provider) so a breach of the app does not cascade to the guard dog.

> **Status:** This is a migration guide. Your project is already deployed on one VM. Follow the phases in order and schedule a maintenance window.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Droplet / VM Recommendations](#droplet--vm-recommendations)
- [GitHub Repository Strategy](#github-repository-strategy)
- [Phase 0: Snapshot And Backup](#phase-0-snapshot-and-backup)
- [Phase 1: Provision VM 2 (Security Server)](#phase-1-provision-vm-2)
- [Phase 2: Decouple The Backend From Local SECURITY Imports](#phase-2-decouple-the-backend)
- [Phase 3: Create The Security Microservice On VM 2](#phase-3-create-the-security-microservice)
- [Phase 4: Docker Compose For Both VMs](#phase-4-docker-compose-for-both-vms)
- [Phase 5: Migrate Data](#phase-5-migrate-data)
- [Phase 6: Cutover And Test](#phase-6-cutover-and-test)
- [Phase 7: Harden The Network](#phase-7-harden-the-network)
- [Appendix A: Files Created During Migration](#appendix-a-files-created-during-migration)
- [Appendix B: Rollback Plan](#appendix-b-rollback-plan)

---

## Architecture Overview

```text
                    Internet
                       |
        +--------------+-------------+
        |                            |
   [VM 1: App Server]         [VM 2: Security Server]
   DigitalOcean                 AWS / Azure / Vultr / Separate DO Account
   (Public-facing)              (Restricted access)
   - WARDS Backend              - Security API (FastAPI)
   - WARDS Frontend             - AI / ML Engine
   - OCR Service                - Quarantine Storage
   - MySQL (business tables)     - MySQL (security tables)
   - Redis                      - Wazuh Manager
   - Wazuh Agent                - Audit Logs & Incidents
   - Security Agent (lightweight event sender)
```

**Communication flow:**
1. App VM sends security events (file changes, logins, admin actions) to Security VM via authenticated HTTPS API.
2. Security VM runs AI scoring, creates incidents, and stores audit data in its own database.
3. The security dashboard queries the Security VM for detections, incidents, and AI state.
4. If the App VM is compromised, the attacker cannot reach the Security VM to delete audit logs or quarantined files.

---

## Droplet / VM Recommendations

### VM 1 — Application Server (Existing)

| Spec | Recommended | Notes |
|---|---|---|
| Provider | DigitalOcean (keep existing) | Already deployed here. |
| OS | Ubuntu 22.04 LTS or 24.04 LTS | Match your current setup. |
| vCPU | 2 | 4 if you have heavy OCR or payment traffic. |
| RAM | 4 GB | 8 GB if you run many concurrent users. |
| Disk | 80 GB SSD | Add volume if storing many uploads/receipts. |
| Network | Public IPv4, firewall on | Only ports 22 (your IP), 3000, 8000. |

### VM 2 — Security Server (New)

| Spec | Recommended | Notes |
|---|---|---|
| Provider | Different from VM 1 (e.g., AWS Lightsail, Azure, Vultr, Linode) | Different account = different credential store = blast radius isolation. |
| OS | Ubuntu 22.04 LTS or 24.04 LTS | |
| vCPU | 1 | Security engine is not constantly CPU-bound. |
| RAM | 2 GB | Enough for MySQL + FastAPI + AI scoring. |
| Disk | 40 GB SSD | Quarantine + ML state + backups. |
| Network | Public IPv4, firewall locked down | Only port 22 (your IP) and 8443 (from VM 1 IP only). |

**Cost estimate:** A second small VM runs roughly $5–$12/month on most providers.

---

## GitHub Repository Strategy

**Use a single repository.** You do not need a second GitHub repo.

Instead, use **two deployment directories** on their respective VMs, both cloning the same repo:

| VM | Clone path | What runs |
|---|---|---|
| VM 1 (App) | `/opt/wards/app` | `docker-compose.yml` (backend, frontend, mysql, redis) |
| VM 2 (Security) | `/opt/wards/security` | `docker-compose.security.yml` (security-api, mysql) |

Both VMs pull from the same `main` branch. The CI workflow can be extended later to deploy VM 2 as well.

**Branch strategy during migration:**
- Create a feature branch: `git checkout -b feat/security-vm-split`
- Do all code changes there.
- Test on staging droplets if possible.
- Merge to `main` only after both VMs are provisioned and tested.

---

## Pre-flight Checklist

Before touching any running server, confirm:

- [ ] You have SSH access to VM 1 as root.
- [ ] You have created a DigitalOcean snapshot of VM 1.
- [ ] You have exported the VM 1 database to a local file.
- [ ] Your repo is clean on `main` and you have pushed the latest code.
- [ ] You have created the `feat/security-vm-split` branch for all changes.
- [ ] You know VM 1's public IP and have VM 2's public IP ready.
- [ ] You have generated a strong shared API key (`openssl rand -hex 32`).
- [ ] You have scheduled a maintenance window (backend will restart during cutover).

---

## File Mapping: What Lives Where

| Path / Component | VM 1 (App) | VM 2 (Security) | Notes |
|---|---|---|---|
| `WARDS/backend/` | Yes | No (copied into image only) | Main backend code stays on VM 1. |
| `WARDS/frontend/` | Yes | No | Built and served on VM 1. |
| `OCR/` | Yes (volume mount) | No | OCR service stays on VM 1. |
| `SECURITY/` | **No** (after cleanup) | **Yes** (volume mount + image copy) | Moved entirely to VM 2. |
| `QUARANTINE/` | **No** (after cleanup) | **Yes** (volume mount) | Quarantine storage moves to VM 2. |
| MySQL `wards_db` (business tables) | Yes | No | User/receipt/queue data stays local. |
| MySQL `wards_security_db` | No | Yes | Security tables migrate to VM 2. |
| Redis | Yes | No | Rate limiting / sessions on VM 1. |
| Wazuh agent | Yes | Yes (optional) | FIM on VM 1 watches `WARDS/` and `OCR/` only. FIM on VM 2 watches `SECURITY/` and `QUARANTINE/`. |

---

## Phase 0: Snapshot And Backup Before You Start

Do not skip this. You are about to change the architecture of a running system.

1. **Create a DigitalOcean snapshot** of your existing droplet (VM 1).
2. **Export the database:**
   ```bash
   cd /opt/wards/app
   docker compose exec mysql mysqldump -uroot -p wards_db > wards_db_backup_pre_migration.sql
   ```
3. **Copy the backup off the droplet:**
   ```bash
   scp root@DROPLET_PUBLIC_IP:/opt/wards/app/wards_db_backup_pre_migration.sql ./
   ```
4. **Commit current working state to Git:**
   ```bash
   git status
   git add -A
   git commit -m "pre-migration: single VM deployment state"
   ```

---

## Phase 1: Provision VM 2 (Security Server)

1. Create the VM with the specs above.
2. SSH in and run the setup script (or do steps 2–4 manually):
   ```bash
   # Option A: use the provided script
   export REPO_URL=git@github.com:your-org/wards.git
   bash scripts/setup_vm2.sh

   # Option B: manual steps
   # Install Docker + Docker Compose (same commands as VM 1 — see DEPLOYMENT_IMPLEMENTATION.md section 2)
   mkdir -p /opt/wards/security
   cd /opt/wards/security
   git clone REPO_SSH_OR_HTTPS_URL app
   cd app
   git checkout main
   ```
3. On VM 2, the following folders matter. Everything else is ignored by the Security VM compose:
   - `SECURITY/`
   - `QUARANTINE/`
   - `docker-compose.security.yml`
   - `scripts/setup_vm2.sh` (already used)

---

## Phase 2: Decouple The Backend From Local SECURITY Imports

Currently `WARDS/backend/routes/security_dashboard.py` imports 30+ functions directly from `SECURITY.security_engine`. We will replace those with an **adapter module** that talks to VM 2 over HTTP when `SECURITY_API_URL` is configured, or falls back to local imports when it is not.

This approach means:
- **Before migration:** `SECURITY_API_URL` is empty. The backend uses local imports as it does today.
- **During migration:** You can test individual endpoints against VM 2 by setting the URL.
- **After migration:** `SECURITY_API_URL` points to VM 2. The security engine runs remotely.

### Files to modify on VM 1

All of these changes are already committed in the repo on the `feat/security-vm-split` branch:

1. **Create `WARDS/backend/utils/security_client.py`** — The adapter module. See `utils/security_client.py` in this repo for the full implementation.
2. **Update `WARDS/backend/routes/security_dashboard.py`** — Replace direct `SECURITY.security_engine` imports with imports from `utils.security_client`.
3. **Update `WARDS/backend/routes/unified_auth.py`** — Replace `SECURITY.security_engine.record_context_detection` import with `utils.security_client.record_context_detection`.
4. **Update `WARDS/backend/main.py`** — Skip starting the local background security monitor when `SECURITY_API_URL` is configured (monitoring runs on VM 2).
5. **Update `WARDS/backend/Dockerfile`** — Remove the `COPY SECURITY /SECURITY` line; the backend no longer needs local access to SECURITY code.
6. **Update `docker-compose.yml`** on VM 1 — Remove `./QUARANTINE` volume mount. Keep a temporary read-only `./SECURITY:/SECURITY:ro` mount so `SECURITY.security_models` is still importable during transition. Add `SECURITY_API_URL` and `SECURITY_API_KEY` environment variables.

### What the adapter does

- When `SECURITY_API_URL` is set, it sends HTTP requests to the Security VM API.
- When it is empty, it falls back to importing and calling `SECURITY.security_engine` directly.
- This lets you migrate incrementally without breaking the running system.

### Updating the backend `.env`

Add these new variables to `WARDS/backend/.env` on VM 1:

```env
SECURITY_API_URL=https://SECURITY_VM_IP:8443
SECURITY_API_KEY=long-random-api-key-shared-between-vms
```

> **Do not commit real values.** These go only in the deployed `.env` file.

### Important: Security ORM Models During Transition

The following files still import `SecurityIncident`, `SecurityMonitoredFile`, `SecurityDetectionEvent`, and `SecurityRecoveryEvent` from `SECURITY.security_models` for direct ORM queries. This is expected during the transition:

- `WARDS/backend/routes/security_dashboard.py` — `db.query(SecurityIncident)` etc.
- `WARDS/backend/middleware/dos_protection.py` — records rate-limit detections.
- `WARDS/backend/utils/log_integrity.py` — integrity checks against security events.

This means:

- **Phase 2 (this phase)** moves the *engine functions* (scanning, AI scoring, backup logic) to the adapter.
- **Phase 5** migrates the security database tables to VM 2.
- **Future Phase 8** (not covered here) would update all dashboard, middleware, and utility code to query the Security VM API instead of local ORM, fully removing the local security table dependency.

Until then, keep `SECURITY/security_models.py` accessible on VM 1 and do not delete the security tables from VM 1's database.

### Wazuh FIM Paths After Migration

On VM 1, remove the `SECURITY` path from `/var/ossec/etc/ossec.conf` file integrity monitoring because `SECURITY/` will no longer live on VM 1:

```xml
<!-- On VM 1 — keep these -->
<directories check_all="yes" realtime="yes">/opt/wards/app/WARDS</directories>
<directories check_all="yes" realtime="yes">/opt/wards/app/OCR</directories>
<!-- REMOVE this line from VM 1 after migration -->
<!-- <directories check_all="yes" realtime="yes">/opt/wards/app/SECURITY</directories> -->
```

On VM 2, add `SECURITY/` to Wazuh agent config (if you install the agent there):

```xml
<!-- On VM 2 -->
<directories check_all="yes" realtime="yes">/opt/wards/security/app/SECURITY</directories>
<directories check_all="yes" realtime="yes">/opt/wards/security/app/QUARANTINE</directories>
```

---

## Phase 2b: VM 1 Cleanup — Removing Existing SECURITY Folders

Because VM 1 was already deployed with the full repo, the `SECURITY/` and `QUARANTINE/` folders exist on disk and are tracked by Git. You cannot simply delete them from the repo because Git will want to track those deletions. Instead, you **keep them in the repo** (so CI and other developers still have the code) but **remove data from the VM 1 filesystem after VM 2 is running**.

> **When to run this:** Only after Phase 6 (cutover) is confirmed working and the Security VM is healthy.

### What you CAN and CANNOT delete yet

Because `security_dashboard.py` still imports `SecurityIncident`, `SecurityMonitoredFile`, etc. from `SECURITY.security_models` at **module load time**, you **must keep the Python source files (`SECURITY/*.py`) on VM 1** until Phase 8 (future work) fully decouples those imports.

**You CAN safely delete:**
- `QUARANTINE/` — entire folder moves to VM 2.
- `SECURITY/local_backups/` — backup storage moves to VM 2.
- `SECURITY/ml/` — ML state moves to VM 2.
- `SECURITY/monitoring/` — monitoring data moves to VM 2.
- `SECURITY/wazuh/` — Wazuh config moves to VM 2.
- `SECURITY/database_monitor/` — DB snapshots move to VM 2.

**You MUST keep (for now):**
- `SECURITY/*.py` files — `security_engine.py`, `security_models.py`, etc.
- The read-only `./SECURITY:/SECURITY:ro` mount in `docker-compose.yml`.

### Step-by-step cleanup on VM 1

1. **SSH into VM 1:**
   ```bash
   ssh root@VM1_DROPLET_PUBLIC_IP
   ```

2. **Run the cleanup script from the repo:**
   ```bash
   cd /opt/wards/app
   bash scripts/cleanup_vm1_security.sh
   ```

   The script will:
   - Stop the backend.
   - Create a final compressed backup of data directories.
   - Delete `QUARANTINE/` entirely.
   - Delete SECURITY data subdirectories (`local_backups/`, `ml/`, `monitoring/`, `wazuh/`, `database_monitor/`).
   - Keep all `SECURITY/*.py` files.
   - Remove the temporary read-only SECURITY mount from `docker-compose.yml`.
   - Rebuild and restart the backend.
   - Remove `SECURITY` from Wazuh FIM config.
   - Optionally drop security tables from the VM 1 database (default: **disabled** — you must set `DROP_SECURITY_TABLES=true`).

3. **If you prefer to do it manually instead of the script:**

   ```bash
   cd /opt/wards/app

   # 1. Stop backend
   docker compose stop backend

   # 2. Final backup of data directories only
   mkdir -p /opt/wards/backups
   tar czf /opt/wards/backups/security_data_final_vm1_$(date +%Y%m%d_%H%M%S).tar.gz \
     SECURITY/local_backups/ SECURITY/ml/ SECURITY/monitoring/ \
     SECURITY/wazuh/ SECURITY/database_monitor/ QUARANTINE/

   # 3. Delete QUARANTINE entirely
   rm -rf QUARANTINE/

   # 4. Delete SECURITY data directories but KEEP *.py files
   rm -rf SECURITY/local_backups/ SECURITY/ml/ SECURITY/monitoring/ \
          SECURITY/wazuh/ SECURITY/database_monitor/

   # 5. Remove temporary read-only SECURITY mount from compose
   sed -i '/TEMPORARY (Phase 2-6)/,/- \/SECURITY:ro/d' docker-compose.yml

   # 6. Rebuild backend
   docker compose up -d --build backend

   # 7. Remove SECURITY from Wazuh FIM
   sed -i '/\/opt\/wards\/app\/SECURITY/d' /var/ossec/etc/ossec.conf
   systemctl restart wazuh-agent
   ```

### Important notes about Git

- **Do NOT `git rm -r SECURITY/`** on your local machine. The code is still needed in the repo for VM 2 and for CI.
- On VM 1, `git status` will show that data directories inside `SECURITY/` are deleted. Do **not** commit these deletions from the server — they are local-only runtime artifacts.

### Database tables on VM 1

The `security_*` tables in the VM 1 MySQL `wards_db` will remain until you explicitly drop them. The adapter still falls back to local ORM models if the remote API is unavailable, so keeping the tables is a safety net during transition. Once you are confident in VM 2:

```bash
# Run this ON VM 1 only when you are ready
cd /opt/wards/app
export DROP_SECURITY_TABLES=true
bash scripts/cleanup_vm1_security.sh
```

Or manually:
```bash
docker compose exec mysql mysql -uroot -p wards_db -e "
DROP TABLE IF EXISTS security_incidents;
DROP TABLE IF EXISTS security_detection_events;
DROP TABLE IF EXISTS security_recovery_events;
DROP TABLE IF EXISTS security_admin_file_changes;
DROP TABLE IF EXISTS security_monitored_files;
DROP TABLE IF EXISTS security_settings;
"
```

---

## Phase 3: Create The Security Microservice On VM 2

On VM 2, create a small FastAPI app that wraps the existing `security_engine.py` functions and exposes them as authenticated API endpoints.

### Files to create on VM 2

1. **Create `SECURITY/api_main.py`** — The FastAPI microservice. It imports the existing `security_engine.py` functions and exposes them as REST endpoints protected by an `X-API-Key` header. See `SECURITY/api_main.py` in this repo.
2. **Create `SECURITY/Dockerfile.security`** — A Dockerfile that builds the security service. See `SECURITY/Dockerfile.security`.

### How the microservice works

- It runs on port `8443` inside a Docker container.
- It requires `X-API-Key` matching `APP_API_KEY` on every request.
- It reuses the same `database.models` and `SECURITY/security_engine.py` logic already in the repo.
- It has its own MySQL container (`wards_security_db`) for security tables.

---

## Phase 4: Docker Compose For Both VMs

### VM 1 — `docker-compose.yml` (updated)

```yaml
services:
  mysql:
    image: mysql:8.0
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:-wards_root_password}
      MYSQL_DATABASE: ${MYSQL_DATABASE:-wards_db}
    ports:
      - "127.0.0.1:3306:3306"
    volumes:
      - wards_mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - wards_redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 10

  backend:
    build:
      context: .
      dockerfile: ./WARDS/backend/Dockerfile
    restart: unless-stopped
    env_file:
      - ./WARDS/backend/.env
    environment:
      DATABASE_URL: mysql+pymysql://root:${MYSQL_ROOT_PASSWORD:-wards_root_password}@mysql:3306/${MYSQL_DATABASE:-wards_db}
      REDIS_URL: redis://redis:6379/0
      SECURITY_DEPLOYMENT_MODE: deployed
      SECURITY_MONITORING_ENABLED: "true"
      SECURITY_API_URL: ${SECURITY_API_URL:-}
      SECURITY_API_KEY: ${SECURITY_API_KEY:-}
    ports:
      - "8000:8000"
    depends_on:
      mysql:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - ./WARDS:/WARDS
      - ./OCR:/OCR
      # TEMPORARY (Phase 2-6): read-only SECURITY mount so security_dashboard.py
      # can still import SECURITY.security_models during transition.
      # Remove in Phase 2b after confirming VM 2 is fully handling security.
      - ./SECURITY:/SECURITY:ro

  frontend:
    build:
      context: ./WARDS/frontend
      args:
        VITE_API_BASE_URL: ${VITE_API_BASE_URL:-http://localhost:8000}
        VITE_RECAPTCHA_SITE_KEY: ${VITE_RECAPTCHA_SITE_KEY:-}
    restart: unless-stopped
    environment:
      VITE_API_BASE_URL: ${VITE_API_BASE_URL:-http://localhost:8000}
    ports:
      - "3000:3000"
    depends_on:
      - backend

volumes:
  wards_mysql_data:
  wards_redis_data:
```

### VM 2 — `docker-compose.security.yml`

Create this file in the repo root. It only runs on the Security VM.

```yaml
services:
  security-db:
    image: mysql:8.0
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: ${SEC_MYSQL_ROOT_PASSWORD:-sec_root_password}
      MYSQL_DATABASE: wards_security_db
    volumes:
      - sec_mysql_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 10

  security-api:
    build:
      context: .
      dockerfile: ./SECURITY/Dockerfile.security
    restart: unless-stopped
    environment:
      DATABASE_URL: mysql+pymysql://root:${SEC_MYSQL_ROOT_PASSWORD:-sec_root_password}@security-db:3306/wards_security_db
      APP_API_KEY: ${APP_API_KEY:-change-me}
      WARDS_APP_IP: ${WARDS_APP_IP:-}
    ports:
      - "8443:8443"
    depends_on:
      security-db:
        condition: service_healthy
    volumes:
      # Mount the entire SECURITY folder so ml/, local_backups/, monitoring/
      # are all available at the paths security_engine.py expects.
      - ./SECURITY:/app/SECURITY
      - ./QUARANTINE:/app/QUARANTINE

volumes:
  sec_mysql_data:
```

### Root `.env` on VM 2

Create `/opt/wards/security/app/.env`:

```env
SEC_MYSQL_ROOT_PASSWORD=CHANGE_ME_STRONG_PASSWORD
APP_API_KEY=long-random-api-key-shared-between-vms
WARDS_APP_IP=VM1_DROPLET_PUBLIC_IP
```

> **Never commit this file.** It is already in `.gitignore`.

---

## Phase 5: Migrate Data

### 5.1 Export security tables from VM 1

```bash
cd /opt/wards/app
docker compose exec mysql mysqldump -uroot -p wards_db \
  security_incidents security_detection_events security_recovery_events \
  security_admin_file_changes security_monitored_files security_settings \
  security_log_views > security_tables_export.sql
```

### 5.2 Transfer to VM 2

```bash
scp /opt/wards/app/security_tables_export.sql root@SECURITY_VM_IP:/opt/wards/security/app/
```

### 5.3 Import into VM 2 security database

```bash
cd /opt/wards/security/app
docker compose -f docker-compose.security.yml up -d security-db
sleep 10
docker compose -f docker-compose.security.yml exec security-db mysql -uroot -p wards_security_db < security_tables_export.sql
```

### 5.4 Copy ML state and backups

```bash
# On VM 1
scp -r /opt/wards/app/SECURITY/ml root@SECURITY_VM_IP:/opt/wards/security/app/SECURITY/
scp -r /opt/wards/app/QUARANTINE root@SECURITY_VM_IP:/opt/wards/security/app/
scp -r /opt/wards/app/SECURITY/local_backups root@SECURITY_VM_IP:/opt/wards/security/app/SECURITY/
```

---

## Phase 6: Cutover And Test

1. **Build and start the Security VM:**
   ```bash
   cd /opt/wards/security/app
   docker compose -f docker-compose.security.yml up -d --build
   docker compose -f docker-compose.security.yml ps
   ```

2. **Test the Security API from VM 1:**
   ```bash
   curl -H "X-API-Key: YOUR_SHARED_KEY" https://SECURITY_VM_IP:8443/
   ```
   You should see the FastAPI docs redirect or a JSON response.

3. **Set `SECURITY_API_URL` on VM 1** in `WARDS/backend/.env`:
   ```env
   SECURITY_API_URL=https://SECURITY_VM_IP:8443
   SECURITY_API_KEY=YOUR_SHARED_KEY
   ```

4. **Rebuild and restart VM 1 backend:**
   ```bash
   cd /opt/wards/app
   docker compose up -d --build backend
   ```

5. **Test the security dashboard:**
   - Log in as superadmin.
   - Go to the security dashboard.
   - Confirm detections, incidents, and AI rules load correctly.
   - Run a manual file scan and confirm it works.

6. **Monitor logs on both VMs:**
   ```bash
   # VM 1
   docker compose logs -f backend
   # VM 2
   docker compose -f docker-compose.security.yml logs -f security-api
   ```

---

## Phase 7: Harden The Network

### 7.1 VM 1 Firewall (DigitalOcean)

| Port | Source | Purpose |
|---|---|---|
| 22 | Your team IPs only | SSH |
| 3000 | All IPv4/IPv6 | Frontend (or your domain) |
| 8000 | All IPv4/IPv6 | Backend API (or your domain) |
| 8443 (outbound) | VM 2 IP only | Security API calls |

Block all other inbound traffic.

### 7.2 VM 2 Firewall (Your second provider)

| Port | Source | Purpose |
|---|---|---|
| 22 | Your team IPs only | SSH |
| 8443 | VM 1 IP only | Security API |

**Nothing else is allowed.** VM 2 should not be reachable from the public internet except via port 8443 from VM 1.

### 7.3 Shared API Key

- Generate a strong random key: `openssl rand -hex 32`
- Store it in both `.env` files (VM 1 `SECURITY_API_KEY` and VM 2 `APP_API_KEY`).
- Rotate it if either VM is suspected to be compromised.

### 7.4 HTTPS Between VMs

If you do not have a domain with TLS for VM 2, you can:
- Use a **self-signed certificate** on the Security API and pin the cert fingerprint in the adapter.
- Or use a **Cloudflare Tunnel** or **Tailscale** mesh network for encrypted VM-to-VM communication without public exposure.

---

## Appendix A: Files Created During Migration

| File | Purpose | VM |
|---|---|---|
| `WARDS/backend/utils/security_client.py` | HTTP adapter for security engine | VM 1 |
| `SECURITY/api_main.py` | FastAPI microservice exposing security functions | VM 2 |
| `SECURITY/Dockerfile.security` | Docker build for the security microservice | VM 2 |
| `docker-compose.yml` (updated) | Removed SECURITY/QUARANTINE mounts, added API env vars | VM 1 |
| `docker-compose.security.yml` | New compose file for the security stack | VM 2 |
| `scripts/setup_vm2.sh` | Automates Docker install, clone, and first start on VM 2 | VM 2 |
| `scripts/cleanup_vm1_security.sh` | Safely removes SECURITY/QUARANTINE from VM 1 after cutover | VM 1 |
| `WARDS/backend/.env.example` (updated) | Added `SECURITY_API_URL` and `SECURITY_API_KEY` placeholders | VM 1 |

---

## Appendix B: Rollback Plan

If something breaks during migration:

1. **Unset `SECURITY_API_URL` on VM 1** and restart the backend:
   ```bash
   cd /opt/wards/app
   # Remove or comment out SECURITY_API_URL in WARDS/backend/.env
   docker compose up -d --build backend
   ```
   The backend will fall back to local imports and continue working as before.

2. **Restore the original `docker-compose.yml`** from Git if you modified it in-place:
   ```bash
   git checkout -- docker-compose.yml
   docker compose up -d
   ```

3. **Restore the database** from the pre-migration snapshot if needed.

4. **Keep VM 2 running** but isolated until you are ready to try again.

---

## Appendix C: What You Must Do On Each VM (Quick Reference)

### On VM 1 (App Server)

```bash
cd /opt/wards/app

# Pull the new code (includes adapter, updated Dockerfile, updated compose)
git pull origin main

# Edit .env and add (leave URL empty until VM 2 is ready):
# SECURITY_API_URL=
# SECURITY_API_KEY=your-shared-key

# Rebuild backend (still uses local SECURITY because URL is empty)
docker compose up -d --build backend

# Once VM 2 is ready and tested, update .env with VM 2 IP
docker compose up -d --build backend

# After cutover is confirmed working, clean up SECURITY folder
bash scripts/cleanup_vm1_security.sh
```

### On VM 2 (Security Server)

```bash
# One-time setup
export REPO_URL=git@github.com:your-org/wards.git
bash scripts/setup_vm2.sh

# Edit /opt/wards/security/app/.env
cd /opt/wards/security/app
nano .env
# Set SEC_MYSQL_ROOT_PASSWORD, APP_API_KEY (same as VM 1 SECURITY_API_KEY), WARDS_APP_IP

# Start security stack
docker compose -f docker-compose.security.yml up -d --build
docker compose -f docker-compose.security.yml ps

# Import migrated data (after Phase 5)
docker compose -f docker-compose.security.yml exec security-db \
  mysql -uroot -p wards_security_db < security_tables_export.sql
```

---

*End of guide. For the full adapter and microservice code, see the Python files referenced above in the repository.*
