# WARDS Remaining Security Issues Checklist

## 1. Device / Session Binding

**Severity:** Medium
**Status:** NOT FIXED

### Issue

JWT tokens now contain:

* `jti`
* `ip`
* `ua` (User-Agent)

However, the system does not validate the IP address or User-Agent during subsequent requests.

### Impact

* Stolen tokens can still be used from different devices and locations.
* Session hijacking remains possible if a token is compromised.

### Recommended Fix

* Validate stored IP/User-Agent claims during token verification.
* Consider configurable tolerance for IP changes.
* Optionally implement refresh-token rotation and device tracking.

### Verification

* Review `jwt_utils.py`
* Confirm token validation checks IP and User-Agent claims.

---

## 2. Username / Portal Enumeration

**Severity:** Medium
**Status:** PARTIALLY FIXED

### Issue

Login failures now return a generic error message and no longer expose `X-Auth-Portal`.

However:

* `requires_captcha`
* `requires_mfa_setup`

are still returned in certain authentication responses.

### Impact

* Attackers may infer account state information.
* Enables limited account enumeration.

### Recommended Fix

* Return identical responses for all authentication failures.
* Avoid exposing account-specific state before successful authentication.

### Verification

* Review authentication failure responses in `unified_auth.py`.
* Ensure response structure remains identical regardless of account existence or status.

---

## 3. Request Integrity Protection for Internal APIs

**Severity:** Low
**Status:** NOT FIXED

### Issue

Sensitive endpoints still do not verify request integrity using HMAC signatures or similar mechanisms.

Affected areas include:

* Payments
* Remittances
* User role modifications

### Impact

* Requests rely solely on transport-layer security and authentication.
* Additional protection against tampering is absent.

### Recommended Fix

* Implement HMAC request signing for sensitive internal API operations.
* Validate signatures before processing requests.

### Verification

* Review payment, remittance, and user-management endpoints.
* Confirm request signature verification exists.

---

## 4. In-Memory Rate Limiting / Lockout State

**Severity:** Medium
**Status:** PARTIALLY FIXED

### Issue

Abuse-tracking state is now persisted to:

* `abuse_state.json`
* `dos_state.json`

This survives server restarts.

However:

* State is still file-based.
* Multiple application instances do not share state.

### Impact

* Rate-limit bypass remains possible in multi-instance deployments.
* Not suitable for horizontal scaling.

### Recommended Fix

* Move abuse tracking to Redis or another shared datastore.
* Centralize rate-limiting and lockout state.

### Verification

* Confirm state storage uses a distributed/shared backend.

---

## 5. Activity Logging Coverage

**Severity:** Medium
**Status:** PARTIALLY FIXED

### Issue

Critical authentication actions are logged, but some routes still lack audit logging.

Examples include:

* Certain payment state transitions
* Some security dashboard bulk actions

### Impact

* Incident reconstruction may be incomplete.
* Accountability and forensic analysis are reduced.

### Recommended Fix

* Audit all privileged and state-changing endpoints.
* Add `log_activity()` coverage consistently.

### Verification

* Confirm all sensitive actions create audit entries.

---

## 6. Immutable Audit Ledger

**Severity:** Medium
**Status:** NOT FIXED

### Issue

The system uses tamper-evident log hashing.

However:

* Not all events are covered.
* No append-only immutable audit ledger exists.

### Impact

* High-value transactions lack strong non-repudiation guarantees.
* Advanced attackers with system access may still alter audit history.

### Recommended Fix

* Implement append-only audit storage.
* Consider database write-once records, blockchain-style chaining, or external audit storage.

### Verification

* Confirm audit records cannot be modified or deleted without detection.

---

## 7. Public Branch Details Over-Disclosure

**Severity:** High
**Status:** PARTIALLY FIXED

### Issue

The following endpoints remain public:

* `/branches`
* `/branches/{branch_id}`

Returned data still includes:

* Contact information
* Queue counts
* Operating hours
* Internal branch details

Pagination has been added, but the disclosure issue remains.

### Impact

* Unauthenticated users can collect branch operational information.
* Increases information-gathering opportunities for attackers.

### Recommended Fix

* Review whether all returned fields are necessary for public access.
* Remove internal metrics or require authentication where appropriate.

### Verification

* Inspect responses from public branch endpoints.
* Confirm only intended public data is exposed.

---

## 8. Distributed DoS Protection

**Severity:** High
**Status:** PARTIALLY FIXED

### Issue

DoS tracking now persists to JSON files.

However:

* State is not shared across servers.
* Multiple instances maintain separate rate-limit records.

### Impact

* Attackers can bypass protections in load-balanced environments.

### Recommended Fix

* Move rate-limit state to Redis or another centralized store.
* Use distributed locking and shared counters.

### Verification

* Confirm all instances use a common backend for abuse tracking.

---

## 9. Unbounded Database Queries

**Severity:** High
**Status:** PARTIALLY FIXED

### Issue

Queries have been improved with:

* Pagination
* Record limits
* 30-day cutoffs

However:

* Large datasets can still cause performance degradation.
* Some operations still rely on broad scans.

### Impact

* Increased memory and CPU usage as data grows.

### Recommended Fix

* Replace remaining scans with indexed queries.
* Use database-side aggregation instead of Python iteration.
* Review all `.limit(5000)` patterns for scalability.

### Verification

* Confirm large tables are queried using indexes and pagination only.

---

## 10. Public List Pagination Coverage

**Severity:** High
**Status:** PARTIALLY FIXED

### Issue

Pagination has been added to several endpoints.

However:

* Additional public endpoints should be reviewed to ensure consistent pagination and query limits.

### Impact

* Large responses may still affect performance.

### Recommended Fix

* Audit every public list endpoint.
* Enforce pagination defaults and maximum page sizes.

### Verification

* Confirm all public collection endpoints support pagination.

---

## 11. Image Processing Still Contains Blocking Paths

**Severity:** Medium
**Status:** PARTIALLY FIXED

### Issue

Most OCR and QR processing has been moved to executors.

However:

* `_build_queue_ocr_fallback_result`
* `compute_image_ahash`

can still execute synchronously during fallback processing.

### Impact

* Minor event-loop blocking remains possible.

### Recommended Fix

* Move all image-processing operations into executor threads.
* Eliminate synchronous image processing from async request handlers.

### Verification

* Confirm all image-processing functions execute off the event loop.

---

## 12. Large File Upload Limits

**Severity:** Medium
**Status:** PARTIALLY FIXED

### Issue

Limits were reduced to:

* 5 MB maximum request size
* 5 files per request

However:

* Limits may still be higher than necessary for some endpoints.

### Impact

* Resource exhaustion opportunities remain.

### Recommended Fix

* Set endpoint-specific upload limits.
* Apply stricter limits where possible.

### Verification

* Review upload requirements per endpoint.

---

## 13. Security Dashboard Scans Are Expensive

**Severity:** Low
**Status:** NOT FIXED

### Issue

Security dashboard operations still perform:

* Recursive filesystem scans
* ML inference
* Synchronous processing

Examples:

* `full_scan`
* `scan_all_files`

### Impact

* Heavy resource usage.
* Potential service degradation during scans.

### Recommended Fix

* Move scans to background jobs.
* Add job queues and progress tracking.
* Rate-limit scan execution.

### Verification

* Confirm scans execute asynchronously through a worker system.
