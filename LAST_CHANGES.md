# STRIDE Security Assessment — WARDS System

**Assessment Date:** 2026-06-16
**Assessor:** Cascade (AI Code Review)
**Overall STRIDE Rating:** 5.5 / 10

The system demonstrates a genuine security-conscious architecture (field-level encryption, CSP/HSTS headers, UEBA AI engine, token revocation, MFA, and magic-bytes file validation). However, critical gaps remain in access-control enforcement, secret management, information-disclosure boundaries, and distributed hardening. Several findings are high-severity and directly exploitable.

---

## 1. Spoofing (Identity / Authentication) — 6/10

### High Severity
- **Hardcoded JWT Secret Keys**
  - `auth.py:15` uses `SECRET_KEY = "your-secret-key-here-change-in-production"` as a fallback.
  - `unified_auth.py:40-45` uses hardcoded fallback secrets for user, admin, branch, and password-reset tokens.
  - `admin_auth.py:17` hardcodes admin secret fallback.
  - **Impact:** If any environment variable is unset, an attacker can forge any token for any portal.

- **Hardcoded reCAPTCHA Secret Key**
  - `unified_auth.py:45` embeds a real-looking default: `6LdOdsAsAAAAAHPw5OFtL757OAFc7SRJB618yE-D`.
  - **Impact:** reCAPTCHA verification can be bypassed if the env var is missing.

- **OTP Returned in Response Body**
  - `admin_auth.py:161-163` returns the generated OTP directly in the JSON response: `{"otp": otp}`.
  - **Impact:** The second factor is disclosed to the attacker on the same channel, defeating MFA.

### Medium Severity
- **No Device / Session Binding**
  - JWT tokens are not bound to device fingerprints, IP, or User-Agent. Stolen tokens work from any location.
  - `token_revocation.py` only stores SHA-256 hashes but does not track issuance context.

- **Username / Portal Enumeration**
  - `unified_auth.py:724-790` returns different error messages and headers (`X-Auth-Portal`, `X-Requires-Captcha`) depending on whether the account exists, enabling targeted enumeration.
  - `admin_auth.py:125-143` similarly distinguishes between "not found" and "invalid password" through timing and log events.

- **Legacy Auth Route (`auth.py`) Still Active**
  - `auth.py` provides a separate `/login` endpoint with its own weak secret and no rate-limiting decorator.
  - **Impact:** Provides a bypass path if unified auth is hardened but the legacy route remains reachable.

### Low Severity
- **No `jti` Claim in JWTs**
  - Tokens lack a unique JWT ID, making it harder to revoke individual tokens precisely without maintaining a full revocation list.

---

## 2. Tampering (Data Integrity) — 5/10

### Critical Severity
- **Unauthenticated Queue Status Update**
  - `public.py:732` (`PUT /queue/{queue_id}/status`) has **no authentication dependency**. Anyone can update any queue status.
  - **Impact:** Tampering with public service queues, skipping ahead, or clearing queues maliciously.

### High Severity
- **No Webhook Signature Verification**
  - `payments.py` (PayMongo webhook handlers) does not verify webhook signatures. The `PayMongoWebhookPayload` model accepts any `data` dict.
  - **Impact:** An attacker can spoof payment success callbacks and force payments to "Verified" without actual money transferred.

- **CORS Allows Wildcard Methods and Headers**
  - `main.py:267-268` sets `allow_methods=["*"]` and `allow_headers=["*"]`.
  - **Impact:** Cross-origin requests with arbitrary headers/methods are permitted, increasing XSS/CSRF surface.

### Medium Severity
- **File Upload — Macro-Enabled Extensions Allowed**
  - `file_validation.py:129` default `allowed_extensions` includes `.doc` and `.xls` (OLE compound files).
  - **Impact:** Malicious macros or embedded objects could be uploaded and later opened by staff.

- **`.env` File Mutation via API**
  - `security_dashboard.py:63-86` (`update_backend_env`) writes arbitrary key-value pairs directly to the backend `.env` file from API input.
  - **Impact:** If an admin session is compromised, attacker can persist malicious config (e.g., database URLs, secrets) to disk.

- **SQLite Default Database**
  - `database/models.py:23-44` defaults to a local SQLite file if `DATABASE_URL` is unset.
  - **Impact:** File-based DB lacks granular access controls; file copy = full data exfiltration.

### Low Severity
- **No Request Integrity Signatures on Internal APIs**
  - Endpoints that modify sensitive state (payments, remittances, user roles) do not verify request body integrity via HMAC or similar.
- **Disable private IP exemption for abuse detection** 
  - Change `EXEMPT_PRIVATE_IPS` default to `false` or remove the feature entirely.

---

## 3. Repudiation (Audit & Non-Repudiation) — 6/10

### Medium Severity
- **In-Memory Rate Limiting / Lockout State**
  - `admin_auth.py:21-22` stores `login_attempts` and `locked_accounts` in module-level dictionaries.
  - `unified_auth.py:95-96` does the same.
  - **Impact:** Restarting the server clears all abuse history, allowing an attacker to deny their failed-attempt pattern ever occurred.

- **Activity Logging Gaps**
  - `log_activity` is used in auth flows but is missing from many critical routes (e.g., queue status updates, bulk security-dashboard actions, some payment state transitions).
  - **Impact:** Admins cannot reconstruct the full chain of events for an incident.

- **No Immutable Audit Ledger**
  - While `utils.log_integrity` provides tamper-evident log signing, not all events are covered, and there is no append-only distributed ledger for high-value transactions.

### Low Severity
- **OTP Delivery Not Logged**
  - In `admin_auth.py`, OTPs are generated but email/SMS dispatch success/failure is not explicitly logged per attempt.

---

## 4. Information Disclosure — 5/10

### Critical Severity
- **Public Queue Endpoint Exposes PII**
  - `public.py:708-730` (`GET /queue/branch/{branch_id}`) requires **no authentication** and returns:
    - `taxpayer_name`
    - `contact_number`
    - `queue_number`
    - `service_type`
    - `status`
  - **Impact:** Mass collection of citizen personal data by any unauthenticated visitor.

### High Severity
- **Public Branch Details Over-Disclosure**
  - `public.py:417-471` (`GET /branches/{branch_id}`) returns internal queue counts, contact info, and announcement attachments without auth.
  - `public.py:374-415` (`GET /branches`) returns all active branch contacts and current waiting counts.

- **Simulated RPT Data Contains Realistic PII**
  - `payments.py:82-121` hardcodes realistic names and residential addresses (e.g., "Justin Paolo M. Cortez", "18 Sampaguita St., Galas, Quezon City") in source code.
  - **Impact:** If this is test data, it still appears in source control and could be mistaken for production records.

- **Exception Handler Leaks in Dev Mode**
  - `main.py:185-189` only masks exceptions when `APP_ENV=production`. In any other env, full stack traces are returned to the client.
  - **Impact:** Path disclosure, library versions, and internal logic exposed.

### Medium Severity
- **`verify_auth_users.py` Prints Hash Previews**
  - `verify_auth_users.py:55` prints `admin.hashed_password[:20] + "..."` to stdout.
  - **Impact:** Partial hash disclosure aids offline cracking prioritization.

- **`X-Auth-Portal` Header Leaks Account Type**
  - `unified_auth.py` returns `X-Auth-Portal` on login failures, revealing whether the identifier belongs to a public, admin, or branch account.

- **CORS Exposes Custom Headers**
  - `main.py:269` exposes `X-Requires-Captcha`, `X-Requires-MFA-Setup`, `X-Auth-Portal`, etc. to arbitrary origins.

### Low Severity
- **Queue Registration Duplicate Detection Leakage**
  - `public.py:260-291` (`find_existing_active_queue`) checks contact number and email. A malicious user can probe whether someone else is currently queued.

---

## 5. Denial of Service — 5/10

### High Severity
- **In-Memory Abuse Tracking Is Non-Distributed and Ephemeral**
  - `middleware/dos_protection.py:51-67` uses module-level dictionaries (`request_history`, `endpoint_request_history`, `account_rate_limit_state`, `blocked_ips`).
  - **Impact:** Per-IP / per-account blocking does not survive process restart; multiple server instances do not share state, allowing trivial bypass.

- **Unbounded Database Queries**
  - `public.py:597` (`generate_next_queue_number`) calls `db.query(Queue).all()` and iterates the entire table in Python.
  - `public.py:216` (`resolve_public_branch_by_name`) calls `db.query(Branch).all()`.
  - **Impact:** Linear growth in queue/branch records = linear growth in response time and memory, leading to OOM or timeout.

- **No Pagination on Public Lists**
  - `public.py:708-730` (`get_branch_queues`) returns every queue record for a branch without pagination.

### Medium Severity
- **Image Processing Blocks Event Loop**
  - `receipts.py` uses `PIL.Image`, `qrcode`, and `ocr_service` in synchronous route handlers.
  - **Impact:** CPU-intensive image operations block the async event loop for all clients.

- **Large File Upload Limits**
  - `MAX_REQUEST_SIZE = 10 MB` may be high for typical form submissions; combined with no file-count limits per request, this could be abused.

### Low Severity
- **Security Dashboard Scans Are Expensive**
  - `security_dashboard.py` routes like `scan_all_files` can trigger full recursive filesystem walks and ML inference synchronously.

---

## 6. Elevation of Privilege — 5/10

### Critical Severity
- **Unauthenticated Queue Status Update = Privilege Bypass**
  - Same finding as Tampering (`public.py:732`). By updating queue status without auth, an anonymous user gains branch-admin operational privileges.

### High Severity
- **`get_current_admin_user` Accepts BranchStaff Tokens**
  - `middleware/admin_auth.py:37-85` attempts to decode with unified secrets; if a `BranchStaff` token is valid, it is accepted as an admin user for routes protected by `get_current_admin_user`.
  - `alerts.py:31` uses `get_current_admin_user`, meaning a branch staff member can view admin-level alerts.

- **Role Escalation via User Update Endpoint**
  - `routes/users.py:40-47` (`UserUpdate`) accepts a `role` field. The endpoint requires `current_admin_password`, but there is no explicit check preventing an admin from escalating themselves or others to `main_admin`.
  - **Impact:** A compromised lower-privilege admin account could become `main_admin`.

### Medium Severity
- **Token Type Confusion in Multi-Secret Decoding**
  - `middleware/dos_protection.py:167-187` (`account_from_request`) tries to decode a token against user, admin, and branch secrets in sequence.
  - `public.py:222-257` (`resolve_authenticated_citizen`) tries unified then user secret.
  - **Impact:** If secrets are accidentally shared or weak, a token intended for one portal could be accepted by another.

- **Security Dashboard Requires Only Generic Admin Token**
  - `security_dashboard.py:187-188` (`current_admin`) uses `get_current_admin_from_token` without checking `role == "main_admin"`.
  - **Impact:** Any valid admin or branch-staff token can trigger backups, env mutations, AI retraining, and IP blocks.

- **`User = Admin` Alias Confusion**
  - `database/models.py:250` aliases `User = Admin`.
  - **Impact:** Code reviews and static analysis may miss that `User`-typed parameters actually accept admins, leading to incorrect authorization assumptions.

- **Add authentication to backup endpoints** 
  - `@WARDS/backend/routes/backup.py` has zero auth/authorization. Import and apply `get_current_admin_user` and `require_main_admin`.


### Low Severity
- **MFA Recovery Role (`mfa_recovery`)**
  - `unified_auth.py:88` defines `MFA_RECOVERY_ROLE = "mfa_recovery"`. If this role is ever assigned to a regular user, it could grant unintended recovery privileges.

---

## Summary Table

| STRIDE Category         | Score | Top Risk                                                                 |
|-------------------------|-------|--------------------------------------------------------------------------|
| Spoofing                | 6/10  | Hardcoded secrets and OTP disclosure in response body                    |
| Tampering               | 5/10  | Unauthenticated queue mutation; no webhook signature verification        |
| Repudiation             | 6/10  | In-memory abuse state lost on restart; activity logs incomplete          |
| Information Disclosure  | 5/10  | Public endpoints leak taxpayer PII; dev-mode stack traces exposed      |
| Denial of Service       | 5/10  | In-memory rate limits; unbounded `.all()` queries block event loop       |
| Elevation of Privilege  | 5/10  | BranchStaff tokens accepted as admin; role escalation via update endpoint |
| **Overall**             | **5.5/10** | Strong foundations undermined by missing auth enforcement and weak defaults |

---

## Recommended Immediate Actions

1. **Remove all hardcoded fallback secrets** — require env vars at startup and crash if unset.
2. **Add `Depends` auth to `PUT /queue/{queue_id}/status`** — require branch staff or higher.
3. **Stop returning OTPs in JSON responses** — send only via email/SMS and log delivery attempts.
4. **Implement PayMongo webhook signature verification** — verify `Paymongo-Signature` header.
5. **Restrict CORS** — replace `allow_methods=["*"]` and `allow_headers=["*"]` with explicit allowlists.
6. **Paginate all public list endpoints** and replace `db.query(...).all()` with paginated / scoped queries.
7. **Add role gate to security dashboard** — restrict `.env` mutation, backup triggers, and AI retraining to `main_admin` only.
8. **Validate `role` transitions in `users.py`** — prevent escalation to `main_admin` without an existing `main_admin` password.
9. **Move rate-limit / abuse state to Redis** (or at least a shared persistent store) for multi-instance deployments.
10. **Audit all `public.py` endpoints** — ensure PII is only returned to authenticated, authorized users.
