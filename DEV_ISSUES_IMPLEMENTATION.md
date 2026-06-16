# WARDS Pre-Development Implementation Guide

> **Version:** 1.0  
> **Last Updated:** 2026-06-16  
> **Status:** Pre-Deployment Security Hardening  
> **Constraint:** All changes must be backward-compatible. Do not break existing unified auth, MFA, payment flows, or branch portal functions.

---

## How to Use This File

Each section contains:
1. **What it is** — the requirement
2. **Current progress** — verified state from the latest code review
3. **Implementation steps** — safe, incremental changes with file paths
4. **Verification** — how to confirm it works

> **CRITICAL:** Before modifying any route in `unified_auth.py`, `mfa.py`, `payments.py`, or `public.py`, run the test suite and confirm `35 passed, 1 warning`.

```powershell
$env:PYTHONPATH="C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend"
& "c:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Scripts\python.exe" -m pytest tests -v --tb=short
```

Note: Postgresql is mostly used as an example here. We also migrated from sqlite, so our main and only database is mysql.

---

# PHASE 1: CRITICAL — MUST FIX BEFORE DEPLOYMENT

---

## ## 1.1 Real Database Backup & Restore

**What:** Replace the stub backup system with real database dump/restore while keeping database backups completely separate from WARDS/OCR file backups.

**Current Progress:** `1/10` — `backup.py` creates fake `Backup` records with `random.randint(240, 250) MB` and does not dump the database. Restore is a no-op.

---

## Backup Architecture

Maintain two completely independent backup systems:

### File Backup System (Existing)

Used for:

* WARDS source files
* OCR files
* Uploaded assets
* Configuration snapshots

Storage:

```text
local_backups/
├── wards/
├── ocr/
```

### Database Backup System (New)

Used only for:

* MySQL/PostgreSQL database dumps

Storage:

```text
local_backups/
├── database/
│   ├── 2026-06-16_120000.sql.gz
│   ├── 2026-06-17_120000.sql.gz
│
├── wards/
├── ocr/
```

Database backups must never be mixed into WARDS/OCR backup archives.

---

## Implementation Steps

### 1. Add a Database Backup Utility

Create:

```text
WARDS/backend/utils/backup_engine.py
```

Responsibilities:

* Detect database type from `DATABASE_URL`
* Use:

  * `mysqldump` for MySQL
  * `pg_dump` for PostgreSQL
* Generate timestamped SQL dump
* Compress with gzip
* Calculate SHA-256 checksum
* Store dumps inside:

```text
local_backups/database/
```

Environment variables:

```env
DATABASE_BACKUP_DIR=./local_backups/database
DATABASE_BACKUP_RETENTION_DAYS=30
```

Do not reuse the WARDS/OCR backup directories.

---

### 2. Update Backup Model

Add fields in:

```text
WARDS/backend/database/models.py
```

```python
checksum: str
db_type: str
retention_days: int = 30
backup_category: str = "database"
```

Notes:

* Do not change primary key.
* Existing file backups should continue working.
* Database backups should be identifiable separately from file backups.

---

### 3. Update Database Backup Endpoints

File:

```text
WARDS/backend/routes/backup.py
```

#### create_backup()

Replace stub implementation:

* Perform actual database dump.
* Store compressed dump in database backup directory.
* Save:

  * filename
  * size
  * checksum
  * db_type
  * retention_days
  * backup_category="database"

#### restore_backup()

Before restore:

* Verify backup exists.
* Verify SHA-256 checksum.
* Verify backup_category="database".

Restore using:

* `mysql`
* `psql`

depending on database type.

Log restore event.

---

### 4. Separate Scheduled Backups in Security Dashboard

Current dashboard already contains:

* Scheduled WARDS backup
* Scheduled OCR backup
* Manual backup
* Manual restore

Keep all existing functionality unchanged.

Add a completely separate Database Backup section underneath.

#### Scheduled Database Backup

New controls:

* Enable Scheduled Database Backup
* Backup Frequency
* Retention Days
* Last Backup Status

This schedule should only create database dumps.

It must not trigger:

* WARDS backup
* OCR backup

#### Manual Database Backup

New button:

```text
Create Database Backup
```

Actions:

* Run immediate database dump
* Save to local_backups/database/
* Create Backup record

#### Manual Database Restore

New button:

```text
Restore Database Backup
```

Actions:

* Select database backup
* Verify checksum
* Restore database

Must not affect:

* WARDS files
* OCR files

---

### 5. Separation Requirements

Database backup operations must be completely isolated from file backup operations.

Examples:

✅ Restore database only

```text
Database restored
WARDS files unchanged
OCR files unchanged
```

✅ Restore WARDS backup only

```text
WARDS restored
Database unchanged
OCR unchanged
```

❌ One restore operation affecting all backup types.

---

## Safety Rules

* Do not delete the existing Backup model.
* Do not change the Backup primary key.
* Do not remove `require_main_admin()`.
* Keep database backups outside the web root.
* Do not combine database dumps with WARDS/OCR archives.
* Do not allow database restore operations to modify file-system backups.
* Do not allow file-system restore operations to modify the database.

---

## Verification

### Database Backup

Call:

```http
POST /api/backup/create
```

Confirm:

* Real `.sql.gz` created
* Stored in `local_backups/database/`
* Valid checksum generated
* Backup record created

### Database Restore

Call:

```http
POST /api/backup/restore/{id}
```

Confirm:

* Checksum validation passes
* Database contents restored
* Restore logged

### Isolation Verification

1. Restore a database backup.

2. Confirm WARDS and OCR files remain unchanged.

3. Restore a WARDS backup.

4. Confirm database remains unchanged.

5. Restore an OCR backup.

6. Confirm database and WARDS remain unchanged.


---

## 1.2 Force HTTPS / TLS Redirect

**What:** Block plain HTTP traffic and redirect to HTTPS.

**Current Progress:** `4/10` — `SecurityHeadersMiddleware` adds `Strict-Transport-Security` when `X-Forwarded-Proto: https` is detected, but there is **no middleware that rejects HTTP or redirects to HTTPS**.

### Implementation Steps

1. **Add `HttpsEnforcementMiddleware`** in `WARDS/backend/middleware/https.py` (new file):
   ```python
   class HttpsEnforcementMiddleware(BaseHTTPMiddleware):
       async def dispatch(self, request: Request, call_next):
           # Allow health checks and local dev
           if os.getenv("HTTPS_ONLY", "true").lower() == "false":
               return await call_next(request)
           # Trust X-Forwarded-Proto from reverse proxy
           proto = request.headers.get("x-forwarded-proto", request.url.scheme)
           if proto != "https":
               url = request.url.replace(scheme="https", port=None)
               return RedirectResponse(str(url), status_code=308)
           return await call_next(request)
   ```

2. **Register in `WARDS/backend/main.py`**  
   Add near the top of the middleware stack (after `TrustedHostMiddleware`, before `CORSMiddleware`):
   ```python
   from middleware.https import HttpsEnforcementMiddleware
   app.add_middleware(HttpsEnforcementMiddleware)
   ```

3. **Add env var** to `.env.example`:
   ```
   HTTPS_ONLY=true
   ```

### Safety Rules
- Set `HTTPS_ONLY=false` in local dev so `localhost` still works.
- Do **not** remove `SecurityHeadersMiddleware`; HSTS and redirect are complementary.

### Verification
- Send `curl -I http://localhost:8000/` with `X-Forwarded-Proto: http` → expect `308 Permanent Redirect`.
- Send with `X-Forwarded-Proto: https` → expect `200 OK`.

---

## 1.3 JWT Expiration & Refresh Tokens

**What:** Reduce public/user token lifetime to 15–30 min and add refresh tokens.

**Current Progress:** `6/10` — Admin tokens = 30 min ✅, Branch = 8 hours, User/Public = **24 hours** ❌. No refresh token mechanism exists.

### Implementation Steps

1. **Reduce access token expiry** in `WARDS/backend/auth/jwt_utils.py`:
   ```python
   PORTAL_CONFIG = {
       "admin":    {"secret_key": ADMIN_SECRET_KEY,    "expires_minutes": 30},
       "user":     {"secret_key": USER_SECRET_KEY,     "expires_minutes": 30},  # was 1440
       "branch":   {"secret_key": BRANCH_SECRET_KEY,   "expires_minutes": 30},  # was 480
       "public":   {"secret_key": PUBLIC_SECRET_KEY,   "expires_minutes": 30},  # was 1440
       ...
   }
   ```

2. **Add refresh token creation** in `WARDS/backend/auth/jwt_utils.py`:
   ```python
   REFRESH_TOKEN_EXPIRE_DAYS = 7
   def create_refresh_token(portal: str, data: dict) -> str:
       to_encode = data.copy()
       to_encode["type"] = "refresh"
       to_encode["exp"] = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
       to_encode.setdefault("jti", str(uuid.uuid4()))
       secret = PORTAL_CONFIG[portal]["secret_key"]
       return jwt.encode(to_encode, secret, algorithm=ALGORITHM)
   ```

3. **Update login endpoints** in `WARDS/backend/routes/unified_auth.py`:
   - Return `refresh_token` alongside `access_token`.
   - Add `POST /api/auth/unified/refresh` endpoint that accepts a refresh token and issues a new access token.
   - Store issued refresh `jti` in Redis with a TTL of 7 days.

4. **Update token validation** in `WARDS/backend/auth/decorators.py`:
   - Reject tokens whose `type` == `"refresh"` on protected routes (refresh tokens should only hit `/refresh`).

### Safety Rules
- Do **not** remove the existing `create_access_token()` signature; add the refresh function beside it.
- Keep `jti` generation unchanged.
- Ensure `unified_login()` still works exactly the same for clients that ignore the new `refresh_token` field.

### Verification
- Login as user → access token should expire in ~30 min.
- Use refresh token → new access token issued.
- Try to use refresh token as access token → `403`.

---

## 1.4 Make Redis Mandatory for Rate-Limit State

**What:** Remove file-based fallbacks for rate limiting; require Redis in production.

**Current Progress:** `6/10` — Redis is used when available, but both `middleware/dos_protection.py` and `routes/unified_auth.py` fall back to `./dos_state.json` and `./abuse_state.json`.

### Implementation Steps

1. **Update `WARDS/backend/utils/redis_client.py`**:
   - Add a function `require_redis()` that raises `RuntimeError` if `REDIS_URL` is not set and `APP_ENV` is `production`.

2. **Update `WARDS/backend/middleware/dos_protection.py`**:
   - In `_load_dos_state()` and `_save_dos_state()`, replace file I/O with Redis hashes/lists.
   - If Redis is unavailable in production, raise `RuntimeError` on startup rather than silently using JSON files.

3. **Update `WARDS/backend/routes/unified_auth.py`**:
   - Replace `_load_abuse_state()` / `_save_abuse_state()` JSON operations with Redis keys (`wards:auth:failed:{ip}`, `wards:auth:locked:{account}`).
   - Use Redis `EXPIRE` so keys auto-clean.

4. **Update `.env.example`**:
   ```
   REDIS_URL=redis://localhost:6379/0
   ```

### Safety Rules
- Keep the JSON fallback for **pytest / local dev** when `APP_ENV != production`.
- Do **not** change the `AbuseDetectionMiddleware` interface or HTTP response format.

### Verification
- Start server with `REDIS_URL` unset and `APP_ENV=production` → expect crash on startup.
- Set `REDIS_URL` → login failures should populate Redis keys.

---

## 1.5 Remove Legacy Office Formats from Memo & Branch Uploads

**What:** Disallow `.doc` and `.xls` (OLE) everywhere; allow only `.docx`, `.xlsx`, `.pdf`, `.png`, `.jpg`, `.jpeg`.

**Current Progress:** `5/10` — `file_validation.py` defaults already exclude `.doc`/`.xls`, but `memos.py` and `branch_portal.py` explicitly allow them.

### Implementation Steps

1. **Update `WARDS/backend/routes/memos.py`** (around line 134):
   Change:
   ```python
   allowed_extensions={".pdf", ".png", ".jpg", ".jpeg", ".doc", ".docx", ".xls", ".xlsx"}
   ```
   To:
   ```python
   allowed_extensions={".pdf", ".png", ".jpg", ".jpeg", ".docx", ".xlsx"}
   ```

2. **Update `WARDS/backend/routes/branch_portal.py`** (around line 2224):
   Apply the same removal of `.doc` and `.xls`.

3. **Verify `WARDS/backend/utils/file_validation.py`**:
   Confirm `FILE_SIGNATURES` no longer contains `OLE` as an allowed safe type for general uploads. It can remain in the detection map (to identify and reject `.doc`/`.xls`), but `SafeFileType` enum should not include it.

### Safety Rules
- Do **not** change the `validate_upload_file()` function signature.
- Do **not** alter file signature detection logic; just tighten the `allowed_extensions` argument passed to it.

### Verification
- Upload a `.doc` to memo endpoint → `400` with "Unsupported file extension".
- Upload a `.docx` → success.

---

## 1.6 Restrict CORS Origins (Remove Hardcoded Localhost)

**What:** Do not allow `localhost` origins in production.

**Current Progress:** `6/10` — `build_allowed_origins()` in `main.py` reads `CORS_ORIGINS` from env, but hardcodes `http://localhost:3000`, `3001`, `5173`.

### Implementation Steps

1. **Update `WARDS/backend/main.py`** in `build_allowed_origins()`:
   ```python
   def build_allowed_origins():
       raw = os.getenv("CORS_ORIGINS", "")
       origins = [o.strip() for o in raw.split(",") if o.strip()]
       if not is_production():
           origins += ["http://localhost:3000", "http://localhost:3001", "http://localhost:5173"]
       return origins
   ```

2. **Document in `.env.example`**:
   ```
   CORS_ORIGINS=https://app.wards.gov.ph,https://admin.wards.gov.ph
   ```

### Safety Rules
- Do **not** remove `allow_credentials=True`.
- Do **not** use `"*"` anywhere.

### Verification
- Start with `APP_ENV=production`, `CORS_ORIGINS=https://prod.app` → `localhost:3000` should be rejected.

---

# PHASE 2: HIGH PRIORITY — FIX SOON AFTER DEPLOYMENT

---

## 2.1 Add Missing Rate Limiting Decorators

**What:** Apply `@limiter.limit` to all high-risk endpoints listed in `RATE_LIMITING.md`.

**Current Progress:** `5/10` — Many sensitive endpoints rely only on global `AbuseDetectionMiddleware`.

### Implementation Steps

1. **In `WARDS/backend/routes/unified_auth.py`**, add decorators (keep existing ones, add missing):
   ```python
   @router.post("/setup-mfa")
   @limiter.limit("5/minute")
   async def unified_setup_mfa(...): ...

   @router.post("/verify-mfa-setup")
   @limiter.limit("10/minute")
   async def unified_verify_mfa_setup(...): ...

   @router.get("/verify")
   @limiter.limit("60/minute")
   async def unified_verify(...): ...

   @router.post("/check-contact")
   @limiter.limit("10/minute")
   async def unified_check_contact(...): ...

   @router.post("/verification/confirm")
   @limiter.limit("10/minute")
   async def unified_verification_confirm(...): ...

   @router.post("/branch/staff/verify-mfa")
   @limiter.limit("10/minute")
   async def branch_staff_verify_mfa(...): ...

   @router.put("/user/password")
   @limiter.limit("5/minute")
   async def public_user_change_password(...): ...

   @router.put("/branch/staff/password")
   @limiter.limit("5/minute")
   async def branch_staff_change_password(...): ...

   @router.post("/branch/staff/reset-mfa")
   @limiter.limit("3/minute")
   async def branch_staff_reset_mfa(...): ...

   @router.post("/admin/invite")
   @limiter.limit("10/minute")
   async def admin_create_invite(...): ...
   ```

2. **In `WARDS/backend/routes/users.py` / `admin_users.py`**, add:
   ```python
   @limiter.limit("10/minute")
   ```
   to `create_user`, `update_user`, `delete_user`.

3. **In `WARDS/backend/routes/payments.py`**, add:
   ```python
   @limiter.limit("30/minute")
   ```
   to `process_payment`, `generate_payment_reference`, `paymongo_webhook`.

4. **In `WARDS/backend/routes/security_dashboard.py`**, add:
   ```python
   @limiter.limit("5/minute")
   ```
   to `full_scan`, `create_manual_backup`.

### Safety Rules
- Import `limiter` from the same module pattern already used in each file.
- Do **not** remove existing `@limiter.limit` decorators.
- If a route file does not yet import `limiter`, add it using the same initialization style as `unified_auth.py`:
  ```python
  limiter = Limiter(key_func=get_remote_address)
  ```

### Verification
- Exceed the new limit on each endpoint → expect `429 Too Many Requests`.

---

## 2.2 Disable Debug Mode Explicitly

**What:** Add a global `DEBUG` flag that is forced to `False` in production.

**Current Progress:** `7/10` — `APP_ENV` drives CSP mode, but no explicit `DEBUG=False` enforcement exists.

### Implementation Steps

1. **Add to `WARDS/backend/main.py`** near the top:
   ```python
   DEBUG = os.getenv("DEBUG", "false").lower() == "true"
   if is_production() and DEBUG:
       raise RuntimeError("DEBUG cannot be True when APP_ENV=production")
   ```

2. **Add `DEBUG=false` to `.env.example`**.

### Safety Rules
- Do **not** change how `APP_ENV` is read; only add the guard.

---

## 2.3 Harden Public Branch Endpoints

**What:** Require authentication for detailed branch info or strip internal fields from public responses.

**Current Progress:** `6/10` — `public.py` `/branches` and `/branches/{branch_id}` remain unauthenticated and return operating hours, queue counts, etc.

### Implementation Steps

1. **Option A: Strip public response** (recommended, no auth needed):
   In `WARDS/backend/routes/public.py`, modify `get_all_public_branches` and `get_branch_details` to return only:
   ```python
   {
       "id": branch.id,
       "name": branch.name,
       "location": branch.location,
       "status": branch.status  # "open" / "closed"
   }
   ```
   Remove `counters`, `operating_hours`, `queue_enabled`, `announcements`, `services`, and any contact fields.

2. **Option B: Require auth for full details** (if frontend needs them):
   Keep the current response behind `Depends(get_current_user_or_staff)` and return the stripped version when unauthenticated.

### Safety Rules
- Do **not** break the frontend's public branch map. Confirm with frontend team which fields are actually needed.

---

## 2.4 Secure Cookies

**What:** Ensure all cookies set by the backend have `Secure`, `HttpOnly`, `SameSite=Lax`.

**Current Progress:** `5/10` — Cookie settings were not found in reviewed snippets.

### Implementation Steps

1. **Search the codebase** for `response.set_cookie` or `Set-Cookie`.
2. **Add flags** wherever cookies are set:
   ```python
   response.set_cookie(
       key="session",
       value=token,
       httponly=True,
       secure=is_production(),
       samesite="lax",
       max_age=1800
   )
   ```

### Safety Rules
- Do **not** change cookie names or values; only add flags.

---

## 2.5 Device / Session Binding

**What:** Validate IP and User-Agent on token refresh / protected routes.

**Current Progress:** `4/10` — `jti`, `ip`, and `ua` claims are embedded in JWTs but never validated.

### Implementation Steps

1. **Update `WARDS/backend/auth/decorators.py`**:
   - In `get_current_user` (and similar), after decoding the token, compare `payload.get("ip")` with `request.client.host`.
   - Compare `payload.get("ua")` with `request.headers.get("user-agent")`.
   - If mismatch, reject with `403` and revoke the token (add `jti` to Redis blocklist).

2. **Add binding to token creation** in `jwt_utils.py`:
   ```python
   to_encode["ip"] = request.client.host
   to_encode["ua"] = request.headers.get("user-agent", "")
   ```

### Safety Rules
- Do **not** break mobile users whose IP may change (use a tolerance flag `STRICT_IP_BINDING=false` in `.env` if needed).
- Do **not** change token structure for existing valid tokens; binding only applies to newly issued tokens.

---

# PHASE 3: MEDIUM PRIORITY — STRONGLY RECOMMENDED

---

## 3.1 Immutable / Append-Only Audit Ledger

**What:** Prevent `ActivityLog` rows from being updated or deleted by DB admins.

**Current Progress:** `5/10` — `log_integrity.py` signs records, but rows are still mutable in the database.

### Implementation Steps

1. **Add a database trigger** (PostgreSQL example) or application-layer guard:
   - In `WARDS/backend/database/models.py`, add a SQLAlchemy event listener:
   ```python
   @event.listens_for(ActivityLog, "before_update")
   @event.listens_for(ActivityLog, "before_delete")
   def prevent_audit_mutation(mapper, connection, target):
       raise Exception("ActivityLog is append-only")
   ```

2. **Export signed logs** periodically to an external store (S3, write-once NAS).

---

## 3.2 Background Workers for OCR / Image Processing

**What:** Move CPU-heavy OCR off the request thread.

**Current Progress:** `2/10` — `build_receipt_ocr_result` runs in `run_in_executor()`, but security dashboard scans and some fallback paths still block.

### Implementation Steps

1. **Introduce Celery or RQ**:
   - Add `celery` to `requirements.txt`.
   - Create `WARDS/backend/worker.py` with a Celery app pointing to Redis.
   - Decorate `build_receipt_ocr_result`, `full_system_scan`, and `generate_report` with `@celery_app.task`.
   - Update endpoints to return `202 Accepted` with a `job_id` and add a `GET /api/jobs/{job_id}/status` endpoint.

### Safety Rules
- Do **not** remove the existing synchronous fallback until the worker is fully wired and tested.

---

## 3.3 Centralized Application Logging

**What:** Ship logs to `journald`, Docker logs, or a centralized SIEM.

**Current Progress:** `3/10` — `ActivityLog` exists, but no syslog / journald / Docker logging driver is configured.

### Implementation Steps

1. **Add structured JSON logging** in `WARDS/backend/main.py`:
   ```python
   import logging, json
   class JSONLogFormatter(logging.Formatter):
       def format(self, record):
           return json.dumps({
               "timestamp": self.formatTime(record),
               "level": record.levelname,
               "message": record.getMessage(),
               "module": record.module,
               "request_id": getattr(record, "request_id", None)
           })
   ```
   Configure Uvicorn / Gunicorn to use this formatter.

2. **Add `request_id` propagation** via `contextvars` or middleware.

---

## 3.4 Request Integrity Signatures (HMAC)

**What:** Sign sensitive request bodies to prevent tampering in transit.

**Current Progress:** `2/10` — No HMAC verification on payment, remittance, or role-change endpoints.

### Implementation Steps

1. **Add `WARDS/backend/utils/request_signing.py`**:
   - `sign_request(body: bytes, timestamp: str) -> str`
   - `verify_request(body: bytes, timestamp: str, signature: str) -> bool`

2. **Apply to high-value endpoints** (optional, behind feature flag):
   - `POST /api/payments/process`
   - `PUT /api/admin/users/{role}/{user_id}`
   - `POST /api/backup/restore/{backup_id}`

---

# PHASE 4: LOW PRIORITY / INFRASTRUCTURE

---

## 4.1 Email DNS Records (SPF, DKIM, DMARC)

**What:** Configure DNS TXT records for the sending domain.

**Current Progress:** `0/10` — DNS-level, not in code.

### Instructions
- Add `TXT` record for `@`:
  ```
  v=spf1 include:_spf.google.com ~all
  ```
- Add `TXT` record for `google._domainkey` (DKIM public key from your email provider).
- Add `TXT` record for `_dmarc`:
  ```
  v=DMARC1; p=quarantine; rua=mailto:dmarc@wards.gov.ph
  ```

## 4.2 Server Monitoring

**What:** CPU, RAM, disk, and uptime monitoring.

**Current Progress:** `1/10` — Not configured in codebase.

### Instructions
- Use Prometheus + Grafana or cloud-native monitoring (AWS CloudWatch, GCP Monitoring).
- Export FastAPI metrics via `prometheus-fastapi-instrumentator`.

## 4.3 Refactor `unified_auth.py`

**What:** Decompose the 1,879-line file into smaller modules.

**Current Progress:** `3/10` — Still monolithic.

### Safe Refactor Plan
1. Create `WARDS/backend/auth/routes/` package.
2. Move endpoint groups into:
   - `login.py` — `unified_login`, MFA, verify
   - `register.py` — `unified_register`, invite register, check contact
   - `password.py` — request/reset password
   - `token.py` — refresh, verify token
3. Keep `unified_auth.py` as a thin router aggregator:
   ```python
   from .login import router as login_router
   from .register import router as register_router
   ...
   router.include_router(login_router)
   ```

### Safety Rules
- Do **not** change any URL path or request/response schema.
- Copy decorators and imports exactly; only reorganize code.
- Run the full test suite after each file move.

---

# APPENDIX A: Task Scoring Reference

| Task | Score | Priority |
|------|-------|----------|
| Remove all secrets from GitHub | 9/10 | Medium |
| Ensure .env is in .gitignore | 10/10 | High (done) |
| Use a .env.example | 10/10 | High (done) |
| Remove SQLite fallback | 9/10 | High (done) |
| Use PostgreSQL | 6/10 | Critical |
| Create database backups | 1/10 | Critical |
| Test database restore | 0/10 | Critical |
| Remove remaining legacy secret fallbacks | 10/10 | High (done) |
| Verify JWT expiration | 6/10 | Critical |
| Add jti claim | 10/10 | High (done) |
| Implement login rate limiting | 7/10 | Medium (partially done) |
| Implement registration rate limiting | 6/10 | Medium (partially done) |
| Implement password reset throttling | 5/10 | Medium (partially done) |
| Implement contact form throttling | 0/10 | Medium (N/A) |
| Move rate-limit state out of memory | 6/10 | Critical |
| Force HTTPS | 4/10 | Critical |
| Secure cookies | 5/10 | High |
| Restrict allowed origins | 6/10 | Critical |
| Remove legacy Office formats | 5/10 | Critical |
| Verify upload size limits | 8/10 | Medium (done) |
| Disable debug mode | 7/10 | High |
| Verify no stack traces exposed | 10/10 | High (done) |
| Verify audit logs work | 8/10 | Medium (done) |
| Configure SPF, DKIM, DMARC | 0/10 | Low |
| Configure server monitoring | 1/10 | Low |
| Configure application logs | 3/10 | Low |
| Test database restore | 0/10 | Critical |
| Security headers (CSP, etc.) | 9/10 | High (done) |
| Public branch details over-disclosure | 6/10 | High |
| Refactor unified_auth.py | 3/10 | Low |
| Remove User = Admin alias | 8/10 | Low (done) |
| Move image processing to background workers | 2/10 | Low |
| Improve immutable audit logging | 5/10 | Medium |
| Add device/session binding | 4/10 | High |

---

# APPENDIX B: Quick Checklist Before Every Change

- [ ] Run `pytest tests/ -v --tb=short` → expect `35 passed`
- [ ] Do not change existing function signatures used by tests
- [ ] Do not remove existing `@limiter.limit` decorators
- [ ] Do not change URL paths or JSON response schemas
- [ ] Do not delete existing auth dependencies (`get_current_admin_user`, `require_main_admin`, etc.)
- [ ] Add new env vars to `.env.example` with placeholder values
- [ ] Add new fields to `Backup` / `ActivityLog` models only via Alembic or safe `alter table`
- [ ] Run `pytest` again after change

*End of document.*
