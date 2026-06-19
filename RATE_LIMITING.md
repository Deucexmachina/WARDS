# WARDS Rate Limiting Inventory

## Summary

This document inventories all explicit (`@limiter.limit`) rate-limiting decorators, custom rate-limit checks, and middleware-level protections across the WARDS backend. It also lists high-priority endpoints that currently rely only on blanket DoS middleware rather than targeted per-function limits.

---

## 1. Functions with Explicit `@limiter.limit` Decorators

### `WARDS/backend/routes/unified_auth.py`
Limiter key: **`get_remote_address`** → **IP-based**

| Function | Route | Limit |
|----------|-------|-------|
| `unified_login` | `POST /api/auth/unified/login` | `5/minute` |
| `unified_request_password_reset` | `POST /api/auth/unified/request-password-reset` | `5/hour` |
| `unified_reset_password` | `POST /api/auth/unified/reset-password` | `5/minute` |
| `unified_mfa_recovery_send_otp` | `POST /api/auth/unified/mfa-recovery/send-otp` | `100/hour` |
| `unified_mfa_recovery_verify_otp` | `POST /api/auth/unified/mfa-recovery/verify-otp` | `100/hour` |
| `unified_register` | `POST /api/auth/unified/register` | `3/minute` |
| `unified_verification_request` | `POST /api/auth/unified/verification/request` | `3/minute` |
| `unified_invite_register` | `POST /api/auth/unified/register/invite` | `5/minute` |

### `WARDS/backend/routes/public.py`
Limiter key: **`get_remote_address`** → **IP-based**

| Function | Route | Limit |
|----------|-------|-------|
| `get_all_public_branches` | `GET /api/public/branches` | `60/minute` |
| `get_all_queue_status` | `GET /api/public/queue-status` | `30/minute` |
| `get_branch_queues` | `GET /api/public/queue/branch/{branch_id}` | `30/minute` |
| `register_queue` | `POST /api/public/queue/register` | `3/minute;20/day` |
| `get_my_active_ticket` | `GET /api/public/queue/my-ticket` | `30/minute` |
| `get_my_queue_history` | `GET /api/public/queue/history` | `30/minute` |
| `check_queue_status` | `GET /api/public/queue/{queue_number}` | `30/minute` |
| `create_receipt_request` | `POST /api/public/receipt-request` | `1/minute;10/day` |
| `initiate_payment` | `POST /api/public/payment/initiate` | `5/minute` |
| `verify_payment` | `POST /api/public/payment/{ref_number}/verify` | `10/minute` |

### `WARDS/backend/routes/receipts.py`
Limiter key: **`get_rate_limit_key`** → **Hybrid (user-based if authenticated, otherwise IP-based)**

| Function | Route | Limit |
|----------|-------|-------|
| `upload_receipt_for_ocr` | `POST /api/receipts/records/ocr-upload` | `20/hour;100/day` |
| `upload_mobile_receipt_for_ocr` | `POST /api/receipts/records/mobile-upload-sessions/{token}/upload` | `20/hour` |

### `WARDS/backend/routes/window_staff_account.py`
Limiter key: **`get_remote_address`** → **IP-based**

| Function | Route | Limit |
|----------|-------|-------|
| `check_branch_staff_contact_availability` | `POST /api/branch/account/check-contact` | `20/minute` |

---

## 2. Custom Rate-Limit Functions (Non-Decorator)

### `WARDS/backend/auth/mfa.py`
These are **user/email-based** rate limits, enforced programmatically inside the MFA recovery flow.

| Function | Basis | Limit |
|----------|-------|-------|
| `check_mfa_recovery_rate_limit(email: str)` | Email address | `3/hour` |
| `check_mfa_recovery_confirm_rate_limit(email: str)` | Email address | `5/minute` |
| `issue_mfa_recovery_otp(...)` | Email address + last_sent_at | Resend cooldown (`MFA_RECOVERY_RESEND_COOLDOWN_SECONDS`) |

---

## 3. Global Middleware Rate Limiting (All Endpoints)

The following middleware layers in `WARDS/backend/middleware/dos_protection.py` are applied to **every request** via `main.py`:

| Middleware | Type | Scope |
|------------|------|-------|
| `RequestSizeMiddleware` | Request body / file count | All requests |
| `RequestTimeoutMiddleware` | Request duration | All requests |
| `ConnectionLimitMiddleware` | Concurrent connections | **IP-based** |
| `AbuseDetectionMiddleware` | Path-scoped request volume | **Account/IP hybrid** (authenticated user ID if available, else IP) |

### `AbuseDetectionMiddleware` Thresholds

| Scope | Threshold | Window | Trigger Path Markers |
|-------|-----------|--------|----------------------|
| General | `300` | `60` sec | All non-specific paths |
| Search | `120` | `60` sec | `/search` |
| Registration | `5` | `3600` sec | `/register`, `/queue/register` |
| Password Reset | `5` | `3600` sec | `/request-password-reset`, `/forgot-password` |
| Admin | `600` | `60` sec | `/admin`, `/dashboard`, `/security-dashboard` |
| Auth Failed | `10` | `900` sec | `/login`, `/mfa`, `/otp`, `/verify-email`, `/forgot-password`, `/reset-password` |

---

## 4. Important Functions Missing Explicit `@limiter.limit` Rate Limiting

The following endpoints are **NOT** protected by an explicit SlowAPI `@limiter.limit` decorator. They currently rely solely on the global `AbuseDetectionMiddleware` (or in some cases have no targeted per-account limits). These should be prioritized for targeted rate-limiting implementation.

### Authentication & Identity (High Priority)

| Function | Route | Risk |
|----------|-------|------|
| `unified_setup_mfa` | `POST /api/auth/unified/setup-mfa` | Unauthenticated MFA setup enumeration |
| `unified_verify_mfa_setup` | `POST /api/auth/unified/verify-mfa-setup` | MFA code brute-force |
| `unified_verify` | `GET /api/auth/unified/verify` | Token validation abuse |
| `unified_check_contact` | `POST /api/auth/unified/check-contact` | Contact-number enumeration |
| `unified_verification_confirm` | `POST /api/auth/unified/verification/confirm` | Email verification code brute-force |
| `branch_staff_verify_mfa` | `POST /api/auth/unified/branch/staff/verify-mfa` | MFA verification brute-force |
| `public_user_change_password` | `PUT /api/auth/unified/user/password` | Password-change abuse |
| `branch_staff_change_password` | `PUT /api/auth/unified/branch/staff/password` | Password-change abuse |
| `branch_staff_reset_mfa` | `POST /api/auth/unified/branch/staff/reset-mfa` | MFA reset abuse |
| `admin_create_invite` | `POST /api/auth/unified/admin/invite` | Invite-spam / enumeration |

### User Management (High Priority)

| Function | Route | Risk |
|----------|-------|------|
| `create_user` | `POST /api/accounts/` | Mass account creation |
| `update_user` | `PUT /api/accounts/{user_id}` | Mass account modification |
| `delete_user` | `DELETE /api/accounts/{user_id}` | Mass account deletion |
| `create_user` | `POST /api/admin/users` | Admin mass account creation |
| `update_user` | `PUT /api/admin/users/{role}/{user_id}` | Admin mass account modification |
| `delete_user` | `DELETE /api/admin/users/{role}/{user_id}` | Admin mass account deletion |

### Payments & Financial (High Priority)

| Function | Route | Risk |
|----------|-------|------|
| `process_payment` | `POST /api/payments/process` | Payment-processing abuse / duplicate charges |
| `generate_payment_reference` | `POST /api/payments/generate-reference` | Reference-generation abuse |
| `paymongo_webhook` | `POST /api/payments/paymongo/webhook` | Webhook flooding |
| `pay_request_fee` | `POST /api/receipts/request/{request_id}/pay` | Duplicate payment attempts |

### File Uploads (High Priority)

| Function | Route | Risk |
|----------|-------|------|
| `upload_proof` | `POST /api/receipts/upload-proof` | Unrestricted file upload abuse |
| `save_receipt_record` | `POST /api/receipts/records` | Receipt record flooding |
| `upload_release_copy` | `POST /api/receipts/requests/{request_id}/upload-release-copy` | File upload abuse |
| `process_receipt_ocr` | `POST /api/ocr/process` | OCR compute / upload abuse |
| `upload_business_tax_documents` | `POST /api/payments/bt/applications/{tracking_number}/uploads` | Document upload abuse |

### Resource-Intensive Operations (Medium Priority)

| Function | Route | Risk |
|----------|-------|------|
| `generate_report` | `POST /api/reports/generate` | Report-generation DoS |
| `full_scan` | `POST /api/security/scan` | Security scan DoS |
| `create_backup` | `POST /api/backup/create` | Backup generation DoS |
| `restore_backup` | `POST /api/backup/restore/{backup_id}` | Backup restore DoS |

### Sensitive Configuration (Medium Priority)

| Function | Route | Risk |
|----------|-------|------|
| `update_settings` | `PUT /api/settings/` | Settings-change abuse |
| `save_branch_system_settings` | `PUT /api/branch/settings/system` | Branch settings abuse |
| `publish_branch_appointment_settings` | `POST /api/branch/settings/appointments/publish` | Config abuse |

---

## Notes

- The `tax_assessment.py` route file defines a **hybrid limiter** (`get_rate_limit_key`) but does **not** apply any `@limiter.limit` decorators to its endpoints.
- The `main.py` global limiter (`hybrid_rate_limit_key`) is initialized as `app.state.limiter`, but most route files instantiate their own local `Limiter` objects. This means decorator state is **not shared** across route modules.
