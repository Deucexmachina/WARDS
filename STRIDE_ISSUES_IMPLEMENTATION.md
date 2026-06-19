# WARDS STRIDE Security Issues — Implementation & Remediation Plan

**Document Version:** 1.0  
**Last Updated:** 2026-06-16  
**Overall STRIDE Score:** 5 / 10  
**Tests Status:** 35 passed, 1 warning (do not regress)

---

## CRITICAL COMPATIBILITY WARNING

> **All changes MUST be backward-compatible with the existing authentication and security flows.**  
> Do **NOT** refactor, rename, or remove any of the following without explicit approval:  
> - `UnifiedToken`, `UnifiedLoginRequest`, or any unified-auth Pydantic models  
> - `create_access_token`, `decode_token`, `get_current_user`, `get_current_admin_user`, `get_current_branch_staff`  
> - MFA setup, recovery, or verification flows (`unified_setup_mfa`, `unified_mfa_recovery_send_otp`, `unified_mfa_recovery_verify_otp`, `issue_mfa_recovery_otp`)  
> - `PORTAL_CONFIG`, `jwt_utils.py`, `token_revocation.py`  
> - `log_activity()` or `ActivityLog` schema  
> - `AbuseDetectionMiddleware`, `RequestSizeMiddleware`, or `ConnectionLimitMiddleware`
>
> **Rule of thumb:** Make *additive* or *surgical* changes only. Wrap new logic behind feature flags or env vars when possible.

---

## Executive Summary

| STRIDE Category | Score | Fixed | Partially Fixed | Not Fixed |
|---|---|---|---|---|
| **S**poofing (Identity / Auth) | 6/10 | 5 | 1 | 1 |
| **T**ampering (Data Integrity) | 5/10 | 6 | 0 | 1 |
| **R**epudiation (Audit) | 6/10 | 1 | 2 | 1 |
| **I**nformation Disclosure | 5/10 | 6 | 2 | 0 |
| **D**enial of Service | 5/10 | 0 | 4 | 2 |
| **E**levation of Privilege | 5/10 | 8 | 0 | 0 |
| **Total** | — | **26** | **9** | **5** |

- **5 issues** are completely open (`NOT FIXED`).
- **9 issues** are partially mitigated but need completion.
- All **Critical** and **High** severity bugs identified in earlier rounds have been resolved. Remaining work is mostly **Medium** and **High** hardening.

---

## 1. Spoofing (Identity / Authentication) — 6/10

### Already Fixed (Do Not Regress)

| Issue | Evidence |
|---|---|
| Hardcoded JWT Secret Keys | `jwt_utils.py:11-18` uses `_require_env()` — no fallback strings. |
| Hardcoded reCAPTCHA Secret Key | `unified_auth.py:81` reads via `os.getenv()` with no code fallback. |
| OTP Returned in Response Body | Legacy `admin_auth.py` removed; MFA recovery emails OTP only. |
| Legacy Auth Route (`auth.py`) | File no longer exists in `routes/`. |
| Missing `jti` Claim in JWTs | `jwt_utils.py:69` embeds `jti` via `uuid.uuid4()`. |

### Remaining Issues

#### S-1: Device / Session Binding — **Medium** — `NOT FIXED`

**Current Progress:**  
`create_access_token()` embeds `ip` and `ua` claims (set in `unified_auth.py:660`), but `decode_token()` does **not** validate them. Stolen tokens remain usable from any location or device.

**Implementation:**

1. Add an *optional* env flag: `TOKEN_BIND_IP_UA=true` (default `false` for graceful rollout).
2. In `auth/jwt_utils.py`, add a validation helper:
   ```python
   def validate_token_binding(token_payload: dict, request_ip: str, request_ua: str | None) -> bool:
       if os.getenv("TOKEN_BIND_IP_UA", "false").lower() != "true":
           return True
       token_ip = token_payload.get("ip")
       token_ua = token_payload.get("ua")
       # Allow IP subnet tolerance (e.g., /24) or exact match based on env
       if token_ip and token_ip != request_ip:
           return False
       if token_ua and token_ua != request_ua:
           return False
       return True
   ```
3. In each `get_current_*` dependency (`decorators.py`), after decoding the token, call `validate_token_binding()`.
4. On mismatch, raise `HTTPException(status_code=401, detail="Session context changed. Please log in again.")`.
5. **Do NOT** remove or alter `create_access_token()` signature — the helper is additive.

**Files to touch:** `auth/decorators.py`, `auth/jwt_utils.py` (additive only).

---

#### S-2: Username / Portal Enumeration — **Medium** — `PARTIALLY FIXED`

**Current Progress:**  
Login failures now return a uniform message (`"Invalid credentials or account status."`) and no longer leak `X-Auth-Portal`. However, `requires_captcha` and `requires_mfa_setup` booleans are still returned in the JSON body on specific paths (`unified_auth.py:645`, `694-695`), and the `x-requires-mfa-setup` header is still sent (`unified_auth.py:632`).

**Implementation:**

1. **Option A (Minimal):** Replace account-state flags with a single opaque enum.
   - Change `UnifiedToken` model: remove `requires_captcha`, `requires_mfa_setup`, `mfa_setup_required`.
   - Add one field: `next_step: Optional[str]` with allowed values `{"mfa", "captcha", "none"}`.
   - On failure, always return `"next_step": "none"` (do not reveal *why*).
   - For MFA-required accounts, return `"next_step": "mfa"` only after the password is verified.
   - Remove the `x-requires-mfa-setup` response header entirely.
2. **Option B (Stricter):** Return the exact same JSON structure for *every* login failure, differing only after password verification. This prevents attackers from distinguishing "account does not exist" vs "account exists but needs MFA".
3. Ensure the frontend login flow still works: the UI should look at `next_step === "mfa"` to show the TOTP input field. Do not break the existing MFA prompt logic.

**Files to touch:** `routes/unified_auth.py` (response construction only), any frontend code that reads `requires_captcha` / `requires_mfa_setup`.

---

## 2. Tampering (Data Integrity) — 5/10

### Already Fixed (Do Not Regress)

| Issue | Evidence |
|---|---|
| Unauthenticated Queue Status Update | `public.py:734-756` requires `get_current_branch_staff`. |
| No Webhook Signature Verification | `payments.py:3243-3278` defines `_verify_paymongo_signature()`. |
| CORS Allows Wildcard Methods/Headers | `main.py:263-265` uses explicit allowlists. |
| File Upload — Macro-Enabled Extensions | `file_validation.py:129` whitelists safe extensions only. |
| `.env` File Mutation via API | `security_dashboard.py:63-98` restricts to `ALLOWED_ENV_KEYS`. |
| SQLite Default Database | `models.py:22-28` raises `RuntimeError` if `DATABASE_URL` is missing. |
| Disable private IP exemption for abuse detection | `dos_protection.py:45` defaults `EXEMPT_PRIVATE_IPS` to `false`. |

### Remaining Issues

#### T-1: Request Integrity Protection for Internal APIs — **Low** — `NOT FIXED`

**Current Progress:**  
Sensitive endpoints (payments, remittances, user role modifications) rely solely on TLS + authentication. No HMAC or request-signature validation exists.

**Implementation:**

1. Create `utils/request_signing.py` with an *opt-in* dependency:
   ```python
   def require_internal_signature(request: Request):
       if os.getenv("REQUIRE_INTERNAL_HMAC", "false").lower() != "true":
           return True
       # Validate X-Request-Signature header against body HMAC
       ...
   ```
2. Apply `@limiter.limit(...)` + `Depends(require_internal_signature)` only to the following routes first:
   - `POST /api/payments/process`
   - `PUT /api/admin/users/{role}/{user_id}` (role change)
   - `POST /api/remittances/...` (any state-changing remittance endpoint)
3. Use a dedicated `INTERNAL_API_SECRET` env var (read via `_require_env()` pattern).
4. **Do NOT** enforce this on public-facing or external-webhook endpoints (PayMongo already has its own signature verification).

**Files to touch:** `utils/request_signing.py` (new), selected routes in `payments.py`, `users.py`, `remittances.py`.

---

## 3. Repudiation (Audit & Non-Repudiation) — 6/10

### Already Fixed

| Issue | Evidence |
|---|---|
| OTP Delivery Not Logged | `auth/mfa.py:162-172` logs dispatch success/failure. |

### Remaining Issues

#### R-1: In-Memory Rate Limiting / Lockout State — **Medium** — `PARTIALLY FIXED`

**Current Progress:**  
`unified_auth.py` and `dos_protection.py` now persist state to JSON files (`abuse_state.json`, `dos_state.json`). State survives restarts but is **not shared across instances**.

**Implementation:**

1. The Redis fallback code is *already* written in both files:
   - `unified_auth.py:96-107` calls `get_redis_client()` and falls back to file.
   - `middleware/dos_protection.py:61-89` does the same for all 8 hash keys.
2. To complete the fix:
   - Set `REDIS_URL` in production (and CI/staging).
   - Verify `redis` package is in `requirements.txt`.
   - Remove or deprecate the JSON fallback only after Redis is confirmed stable in all environments.
   - For multi-instance deployments, ensure Redis is configured with persistence (AOF or RDB) so state survives a Redis restart.
3. **No code changes are strictly required** — this is an operational/config fix. If code changes are desired, add a startup warning in `main.py` when `REDIS_URL` is unset and instance count > 1.

**Files to touch:** `.env.example` (add `REDIS_URL`), `main.py` (optional startup check).

---

#### R-2: Activity Logging Coverage — **Medium** — `PARTIALLY FIXED`

**Current Progress:**  
Critical auth flows log via `log_activity()`, but some payment state transitions and bulk security-dashboard actions still lack explicit audit entries.

**Implementation:**

1. Audit the following endpoints for missing `log_activity()` calls and add them:
   - `POST /api/payments/process` — log amount, method, branch, taxpayer.
   - `POST /api/payments/paymongo/webhook` — log webhook event type and reference.
   - `POST /api/security/scan` (`full_scan`) — already logs in some places; verify `scan_all_files` is also covered.
   - `POST /api/backup/create` and `/api/backup/restore/{backup_id}` — log actor, backup ID, and result.
   - `POST /api/settings/` — log changed keys (never log secret values).
2. Ensure every `log_activity()` call includes the actor username and client IP.
3. Keep the existing `log_activity()` helper signature unchanged.

**Files to touch:** `routes/payments.py`, `routes/security_dashboard.py`, `routes/backup.py`, `routes/settings.py`.

---

#### R-3: Immutable Audit Ledger — **Medium** — `NOT FIXED`

**Current Progress:**  
`utils/log_integrity.py` provides tamper-evident hashing per record, but not all events are covered, and there is no append-only distributed ledger for high-value transactions.

**Implementation:**

1. **Phase 1 (Minimal):** Mark `ActivityLog` rows as immutable at the database level.
   - Add a DB trigger or application-level guard that rejects `UPDATE`/`DELETE` on `activity_logs` for rows older than N hours (e.g., 24h).
   - This is a soft-immutability policy; superadmins can still override via a special endpoint that itself is logged.
2. **Phase 2 (Ledger Chain):** Add `previous_hash` column to `ActivityLog`.
   - On insert, hash the previous row’s hash + current payload.
   - Expose `GET /api/audit/integrity-check` that walks the chain and reports breaks.
3. **Phase 3 (External):** Stream high-value events (payments, role changes, backup restores) to an external SIEM or write-once storage (e.g., AWS QLDB, Wazuh archive).
4. Do **not** alter existing `log_activity()` calls — the ledger wrapper should be transparent.

**Files to touch:** `database/models.py` (additive column), `utils/log_integrity.py`, new `routes/audit.py`.

---

## 4. Information Disclosure — 5/10

### Already Fixed (Do Not Regress)

| Issue | Evidence |
|---|---|
| Public Queue Endpoint Exposes PII | `public.py:665-695` now requires `get_current_branch_staff`. |
| Simulated RPT Data Contains Realistic PII | `payments.py:83-122` uses generic placeholders. |
| Exception Handler Leaks in Dev Mode | `main.py:183-185` returns generic 500 unconditionally. |
| `verify_auth_users.py` Prints Hash Previews | No `hashed_password[:20]` strings remain. |
| `X-Auth-Portal` Header Leaks Account Type | Zero matches in `unified_auth.py`. |
| CORS Exposes Custom Headers | `main.py:265` exposes `Content-Disposition` only. |
| Queue Registration Duplicate Detection Leakage | `public.py:808-816` only probes when authenticated. |

### Remaining Issues

#### I-1: Public Branch Details Over-Disclosure — **High** — `PARTIALLY FIXED`

**Current Progress:**  
`/branches` and `/branches/{branch_id}` remain unauthenticated. `get_all_public_branches` now has pagination (`skip`/`limit`), but still returns `counters`, `operating_hours`, and contact info to unauthenticated users.

**Implementation:**

1. In `public.py:333-369` (`get_all_public_branches`), the code already gates detailed fields behind `if current_user:`.
   - **Verify** that `get_optional_current_user` actually requires a valid token (if present). If the token is invalid, it should treat the caller as anonymous, not error out.
   - Confirm that `current_user` is `None` for truly anonymous requests.
   - If `current_user` is `None`, **strip** the following from the response:
     - `counters`
     - `operating_hours` (or return only basic hours, not internal scheduling)
     - Any `contact_number`, `email`, or `manager_name` fields.
2. In `public.py:371-399` (`get_branch_details`), apply the same field-gating logic.
   - If unauthenticated, return: `id`, `name`, `location` only.
   - If authenticated, return the full payload.
3. Add integration tests asserting the anonymous response schema is minimal.

**Files to touch:** `routes/public.py` (field-filtering logic only).

---

#### I-2: Public List Pagination Coverage — **High** — `PARTIALLY FIXED`

**Current Progress:**  
Pagination added to `/branches`, `/queue/branch/{id}`, `/announcements`, `/faqs`, `/taxpayer-guide`, and `/services`. Some public list endpoints may still be unbounded.

**Implementation:**

1. Run an audit query across `routes/public.py` for any `.all()` call inside a `@router.get` handler.
2. For every remaining `.all()` on a public endpoint:
   - Add `skip: int = 0` and `limit: int = Query(100, le=500)` parameters.
   - Replace `.all()` with `.offset(skip).limit(limit).all()`.
3. Add a CI lint rule (or simple grep test) that fails if any new public route uses `.all()` without pagination.

**Files to touch:** `routes/public.py` (query patterns), `tests/` (new regression test).

---

## 5. Denial of Service — 5/10

### Already Fixed

None fully fixed in this category; prior work reduced severity but did not resolve root causes.

### Remaining Issues

#### D-1: Distributed DoS Protection — **High** — `PARTIALLY FIXED`

**Current Progress:**  
Same as **R-1** (shared root cause). `dos_protection.py` persists state to JSON. Multiple instances = separate rate-limit counters.

**Implementation:**

1. **Operational:** Set `REDIS_URL` in all deployed environments.
2. **Code:** In `middleware/dos_protection.py`, ensure `_load_dos_state()` and `_save_dos_state()` prefer Redis and only fall back to JSON when `REDIS_URL` is absent.
   - The code already does this; verify it is working under load.
3. Add a health-check endpoint that reports whether Redis is connected for DoS state.
4. Do **not** remove the JSON fallback until Redis has been running in production without issue for at least one release cycle.

**Files to touch:** `.env.example`, `middleware/dos_protection.py` (health-check only, if desired).

---

#### D-2: Unbounded Database Queries — **High** — `PARTIALLY FIXED`

**Current Progress:**  
`generate_next_queue_number` uses a 30-day cutoff + `.limit(5000)`. `resolve_public_branch_by_name` uses `.limit(500)`. Some other endpoints may still do broad scans.

**Implementation:**

1. Audit `routes/public.py`, `routes/users.py`, `routes/payments.py`, `routes/receipts.py` for:
   - `.all()` without pagination
   - `.filter(...).all()` on large tables without `limit()`
   - Python-side aggregation (e.g., summing lists in memory) that should be DB-side (`func.sum()`)
2. Add database indexes for the most common filter columns if missing:
   - `ActivityLog.created_at`
   - `Queue.created_at`
   - `Payment.created_at`
   - `Queue.status`
3. Replace any remaining `.limit(5000)` with client-driven pagination (default 100, max 500) where the endpoint is called by a UI.
4. For endpoints that *must* return large datasets (e.g., exports), use streaming responses (`StreamingResponse`) or background jobs rather than loading everything into memory.

**Files to touch:** `routes/*.py` (query patterns), `database/models.py` (index additions if needed).

---

#### D-3: Image Processing Still Contains Blocking Paths — **Medium** — `PARTIALLY FIXED`

**Current Progress:**  
Main OCR runs in `run_ocr_in_executor()`. `qrcode.make()` is wrapped. However, `_build_queue_ocr_fallback_result` still calls the synchronous `compute_image_ahash` directly from async request handlers.

**Implementation:**

1. Locate `_build_queue_ocr_fallback_result` and `compute_image_ahash`.
2. Wrap `compute_image_ahash` in `asyncio.get_event_loop().run_in_executor(None, ...)` when called from an async context.
3. If `_build_queue_ocr_fallback_result` is itself synchronous, move the entire fallback builder into an executor:
   ```python
   fallback = await asyncio.get_event_loop().run_in_executor(
       None, _build_queue_ocr_fallback_result, ...
   )
   ``` 
4. Verify the change does not increase fallback response time beyond the existing timeout threshold.

**Files to touch:** `routes/receipts.py` or wherever `_build_queue_ocr_fallback_result` lives.

---

#### D-4: Large File Upload Limits — **Medium** — `PARTIALLY FIXED`

**Current Progress:**  
Global limits: 5 MB request size, 5 files per request. This may still be too high for some endpoints.

**Implementation:**

1. Introduce endpoint-specific upload limits rather than a single global cap:
   - Receipt proof: 2 MB, 1 file
   - Business tax documents: 5 MB, 5 files
   - Security scan uploads: 1 MB, 1 file
   - Announcement attachments: 10 MB, 3 files
2. Implement by adding a small decorator or FastAPI dependency:
   ```python
   def verify_upload_limit(max_bytes: int, max_files: int):
       def checker(request: Request):
           ...
       return checker
   ```
3. Keep `MAX_REQUEST_SIZE` in `dos_protection.py` as the absolute ceiling (defense in depth), but let route-level checks enforce tighter limits.

**Files to touch:** `middleware/dos_protection.py` (keep global ceiling), individual route files (add tighter per-route checks).

---

#### D-5: Security Dashboard Scans Are Expensive — **Low** — `NOT FIXED`

**Current Progress:**  
`full_scan` and `scan_all_files` still trigger recursive filesystem walks and ML inference synchronously.

**Implementation:**

1. The codebase already imports `from utils.background_jobs import job_manager, JobStatus` in `security_dashboard.py:18`.
2. Convert the scan endpoints to enqueue background jobs:
   - `POST /api/security/scan` enqueues `full_scan` and returns `{"job_id": ..., "status": "queued"}`.
   - `GET /api/security/scan/{job_id}` polls status.
3. Ensure the job result (detections, incidents) is written to the DB so the dashboard can display it when complete.
4. Add a per-admin rate limit on scan enqueue (e.g., 1 full scan per 5 minutes) to prevent accidental DoS.

**Files to touch:** `routes/security_dashboard.py`, `utils/background_jobs.py` (if job_manager needs extending).

---

#### D-6: Missing Explicit Rate Limits on Critical Endpoints — **High** — `NOT FIXED`

**Current Progress:**  
Many sensitive endpoints rely solely on the global `AbuseDetectionMiddleware` and lack targeted `@limiter.limit` decorators. Documented in `RATE_LIMITING.md`.

**Implementation:**

1. Add `@limiter.limit(...)` to the following high-priority endpoints (use the same `Limiter` instance pattern already in `unified_auth.py`):

   **Authentication & Identity**
   | Function | Route | Suggested Limit |
   |---|---|---|
   | `unified_setup_mfa` | `POST /api/auth/unified/setup-mfa` | `3/minute` |
   | `unified_verify_mfa_setup` | `POST /api/auth/unified/verify-mfa-setup` | `5/minute` |
   | `unified_verify` | `GET /api/auth/unified/verify` | `30/minute` |
   | `unified_check_contact` | `POST /api/auth/unified/check-contact` | `10/minute` |
   | `unified_verification_confirm` | `POST /api/auth/unified/verification/confirm` | `5/minute` |
   | `branch_staff_verify_mfa` | `POST /api/auth/unified/branch/staff/verify-mfa` | `5/minute` |
   | `public_user_change_password` | `PUT /api/auth/unified/user/password` | `3/minute` |
   | `branch_staff_change_password` | `PUT /api/auth/unified/branch/staff/password` | `3/minute` |
   | `branch_staff_reset_mfa` | `POST /api/auth/unified/branch/staff/reset-mfa` | `3/minute` |
   | `admin_create_invite` | `POST /api/auth/unified/admin/invite` | `10/minute` |

   **User Management**
   | Function | Route | Suggested Limit |
   |---|---|---|
   | `create_user` | `POST /api/accounts/` | `5/minute` |
   | `update_user` | `PUT /api/accounts/{user_id}` | `10/minute` |
   | `delete_user` | `DELETE /api/accounts/{user_id}` | `5/minute` |
   | Admin CRUD on users | `POST/PUT/DELETE /api/admin/users/...` | `10/minute` |

   **Payments & Financial**
   | Function | Route | Suggested Limit |
   |---|---|---|
   | `process_payment` | `POST /api/payments/process` | `10/minute` |
   | `generate_payment_reference` | `POST /api/payments/generate-reference` | `10/minute` |
   | `paymongo_webhook` | `POST /api/payments/paymongo/webhook` | `100/minute` |
   | `pay_request_fee` | `POST /api/receipts/request/{request_id}/pay` | `5/minute` |

2. Ensure the limiter key function is consistent. If a route file defines its own `Limiter`, it will NOT share state with the global one. Prefer importing a shared `limiter` from `main.py` or creating a shared utility.
3. Do **not** change the existing decorated limits in `unified_auth.py` or `public.py` — only *add* new ones.

**Files to touch:** `routes/unified_auth.py`, `routes/users.py`, `routes/payments.py`, and others per the table above.

---

## 6. Elevation of Privilege — 5/10

### Already Fixed (Do Not Regress)

| Issue | Evidence |
|---|---|
| Unauthenticated Queue Status Update | `public.py:737` requires `get_current_branch_staff`. |
| `get_current_admin_user` Accepts BranchStaff Tokens | `decorators.py:28-60` decodes only with `ADMIN_SECRET_KEY` and checks `token_type == "admin"`. |
| Role Escalation via User Update Endpoint | `users.py:472-476` guards `main_admin` assignment. |
| Token Type Confusion in Multi-Secret Decoding | `dos_protection.py:167-193` maps `type` claim to canonical secret. |
| Security Dashboard Requires Only Generic Admin Token | `security_dashboard.py:203-207` checks `ROLE_MAIN_ADMIN` / `ROLE_SUPERADMIN`. |
| `User = Admin` Alias Confusion | Zero matches for `User = Admin`. |
| Backup Endpoints Unauthenticated | `backup.py` applies `require_main_admin()` to all endpoints. |
| MFA Recovery Role (`mfa_recovery`) | Never assigned to regular user accounts. |

### Remaining Issues

None. The 5/10 score reflects **residual architectural risk** rather than active, known unfixed bugs. Maintain vigilance when adding new admin endpoints.

---

## 7. Cross-Cutting Security Hardening

### XSS & Content Security (From `XSS_SECURITY_CHECKLIST.md`)

While XSS is not a distinct STRIDE category, it intersects with **Tampering** and **Information Disclosure**.

**Current State:** The checklist is comprehensive. Ensure these items are verified before each release:
- File upload MIME-type validation and extension allowlisting.
- Sandboxed PDF preview (`sandbox=""`).
- `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options` headers.
- DOMPurify sanitization on all rendered HTML content.
- No `innerHTML`, `document.write`, or `dangerouslySetInnerHTML` with user data.

**Implementation:** Add the checklist as a required CI gate (e.g., a GitHub Actions step that runs the `curl` header verification commands).

---

## 8. Priority Roadmap

### Phase 1 — Immediate (This Sprint)
1. **S-2:** Remove `requires_captcha` / `requires_mfa_setup` enumeration leakage from login responses.
2. **I-1:** Restrict public branch endpoints to minimal fields for anonymous users.
3. **D-6:** Add `@limiter.limit` decorators to auth and payment endpoints missing explicit rate limits.
4. **R-2:** Backfill missing `log_activity()` calls on payment and backup endpoints.

### Phase 2 — Short Term (Next 2 Sprints)
5. **S-1:** Implement optional token IP/UA binding behind `TOKEN_BIND_IP_UA` flag.
6. **D-2:** Audit and paginate remaining unbounded public queries; add DB indexes.
7. **D-3:** Move remaining synchronous image processing off the event loop.
8. **D-4:** Implement endpoint-specific upload size limits.

### Phase 3 — Medium Term (Next Quarter)
9. **R-1 / D-1:** Complete Redis migration for distributed rate-limit state (operational change + health checks).
10. **R-3:** Build append-only audit ledger chain for `ActivityLog`.
11. **T-1:** Add opt-in HMAC request signing for internal financial APIs.
12. **D-5:** Move security dashboard scans to background jobs.

---

## 9. Verification & Regression Testing

### Automated Test Suite

Run before and after every change:

```powershell
$env:DATA_ENCRYPTION_SECRET="replace-with-a-long-random-data-encryption-secret"
$env:DATA_HASH_SECRET="replace-with-a-long-random-data-hash-secret"
$env:LOG_INTEGRITY_SECRET="replace-with-a-long-random-log-integrity-secret"
$env:BACKUP_INTEGRITY_SECRET="replace-with-a-long-random-backup-integrity-secret"
$env:ADMIN_SECRET_KEY="replace-with-a-different-long-random-admin-secret"
$env:USER_SECRET_KEY="your-user-secret-key-change-in-production"
$env:BRANCH_SECRET_KEY="your-branch-secret-key-change-in-production"
$env:PASSWORD_RESET_SECRET_KEY="your-password-reset-secret-key-change-in-production"
$env:RECAPTCHA_SECRET_KEY="6LdOdsAsAAAAAHPw5OFtL757OAFc7SRJB618yE-D"
$env:PYTHONPATH="C:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend"

& "c:\Users\dwayn\Downloads\WARDS_MASTERFILE\WARDS MASTERFILE\WARDS\backend\venv\Scripts\python.exe" -m pytest tests -v --tb=short
```

**Expected:** `35 passed, 1 warning`. Any drop in pass count = regression.

### Manual Spot-Checks After Changes

| # | Check | How |
|---|---|---|
| 1 | Login enumeration removed | Send invalid credentials → response body must not contain `requires_captcha` or `requires_mfa_setup`. |
| 2 | Public branch fields gated | Call `/api/public/branches` without auth → must NOT see `counters` or `operating_hours`. |
| 3 | New rate limits active | Rapid-fire `POST /api/auth/unified/setup-mfa` → should hit 429 after limit. |
| 4 | Token binding works (if enabled) | Log in from IP A, copy token, use from IP B with `TOKEN_BIND_IP_UA=true` → should receive 401. |
| 5 | Activity logs cover payments | Process a payment → `ActivityLog` must contain a payment entry. |
| 6 | DB query pagination | Call any public list endpoint with `?limit=1000` → should be capped at max limit (e.g., 500). |
| 7 | No event-loop blocking | Upload a malformed receipt image that triggers OCR fallback → server should not freeze. |

---

## 10. File Reference Index

| File | Role in STRIDE Remediation |
|---|---|
| `WARDS/backend/auth/jwt_utils.py` | Token creation, decoding, binding validation (S-1) |
| `WARDS/backend/auth/decorators.py` | Auth dependencies — add binding checks here (S-1) |
| `WARDS/backend/routes/unified_auth.py` | Login response enumeration (S-2), missing rate limits (D-6) |
| `WARDS/backend/routes/public.py` | Branch over-disclosure (I-1), unbounded queries (D-2), pagination (I-2) |
| `WARDS/backend/routes/payments.py` | Missing activity logs (R-2), missing rate limits (D-6), request signing (T-1) |
| `WARDS/backend/routes/users.py` | Missing rate limits (D-6), request signing (T-1) |
| `WARDS/backend/routes/security_dashboard.py` | Missing activity logs (R-2), expensive scans (D-5) |
| `WARDS/backend/routes/backup.py` | Missing activity logs (R-2) |
| `WARDS/backend/middleware/dos_protection.py` | Distributed DoS state (D-1, R-1), global request limits |
| `WARDS/backend/utils/redis_client.py` | Redis connectivity for distributed state |
| `WARDS/backend/utils/log_integrity.py` | Audit ledger hashing (R-3) |
| `WARDS/backend/database/models.py` | `ActivityLog` schema, indexes (D-2, R-3) |
| `WARDS/backend/main.py` | CORS, middleware registration, optional startup checks |

---

*End of plan. Update this document as each issue moves from `NOT FIXED` → `PARTIALLY FIXED` → `FIXED`.*

