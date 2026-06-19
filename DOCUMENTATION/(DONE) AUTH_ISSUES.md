# WARDS – Unified Authentication Regression Fixes

## Context

The recent Unified Authentication Consolidation introduced several regressions that broke functionality that previously worked under the fragmented authentication architecture.

The objective is **NOT** to revert back to fragmented authentication.

The objective is to:

1. Keep the unified authentication architecture.
2. Preserve all functionality that existed before consolidation.
3. Restore behavior that was working prior to the consolidation.
4. Ensure all fixes are fully tested and validated.

Reference documentation:

* `AUTH_CONSOLIDATION.md`
* Last known working state before auth consolidation regressions:

  * GitHub Issue/PR: **"Fixed: Remove hardcoded passwords from seed scripts and documentation #248"**

Use that version as a behavioral reference only. Do **not** reintroduce fragmented authentication systems.

---

# Development Requirements

## Important

When modifying code:

* Stop the backend before making code changes.
* This prevents false file-restoration events and invalid monitoring behavior.
* Use the backend during testing and validation after fixes are implemented.

All fixes must be verified through actual workflow testing, not just code inspection.

---

# Issue 1 – Uvicorn Startup Path Exposure

## Current Behavior

Starting the backend displays the full local filesystem path:

```text
INFO:     Will watch for changes in these directories:
['C:\\Users\\dwayn\\Downloads\\WARDS_MASTERFILE\\WARDS MASTERFILE\\WARDS\\backend']
```

## Expected Behavior

The backend should not expose the user's full local filesystem path in startup logs.

Examples of acceptable behavior:

```text
INFO: Will watch for changes
```

or

```text
INFO: Watching backend directory
```

or suppressing this message entirely if appropriate.

## Required Work

* Identify why the full path is being displayed.
* Remove or sanitize path disclosure.
* Preserve hot-reload functionality.

---

# Issue 2 – Superadmin Branch Management Flow

## Current Behavior

When a Superadmin presses **Manage** on a branch:

Backend shows:

```text
POST /api/branches/{id}/superadmin-access
200 OK
```

However:

* Nothing happens immediately.
* User remains on the Superadmin dashboard.
* After logging out, the system unexpectedly redirects to the branch dashboard.

## Expected Behavior

### Manage Button

When Superadmin clicks **Manage**:

1. Access token/context is created.
2. User is immediately redirected to the selected branch dashboard.
3. No logout should be required.

### Return Flow

When leaving branch management:

1. User returns directly to the Superadmin dashboard.
2. Original Superadmin session/context remains intact.
3. No delayed redirects.

## Required Work

* Trace the entire superadmin-access workflow.
* Identify where navigation state is lost.
* Restore immediate branch impersonation/access behavior.
* Verify round-trip navigation.

---

# Issue 3 – Hashed Values Displaying in Frontend

## Current Behavior

Various fields display hashed placeholders instead of actual values.

Examples include:

* ANNOUNCEMENT_CONTENT
* BRANCH_NAME
* Other encrypted/hashed fields

## Expected Behavior

Frontend must display the original decrypted/plaintext values where users are authorized to view them.

Hash values should never appear in normal UI displays.

## Required Work

### Audit All Affected Areas

Search entire frontend and API responses for:

* hashed placeholders
* encrypted display values
* obfuscated values being rendered

Examples:

* Announcements
* Branch management
* Citizen records
* Activity logs
* Dashboard cards
* Tables
* Modals
* Forms
* Detail pages

### Fix Requirements

* Display actual values in frontend.
* Preserve database security model.
* Do not expose hashes to users.
* Maintain encryption-at-rest behavior if currently implemented.

---

# Issue 4 – Citizen Login Failure

## Current Behavior

Citizen accounts cannot log in.

Frontend:

```text
Invalid email address or password
```

Backend:

```text
POST /api/auth/unified/login
401 Unauthorized
```

## Expected Behavior

Valid citizen accounts should authenticate successfully through the unified auth system.

## Required Work

Investigate:

* Citizen account lookup
* Password verification
* User type resolution
* Role mapping
* Authentication middleware
* JWT generation
* Login routing

Verify:

* Existing citizen accounts can log in.
* Newly registered citizen accounts can log in.
* Role-based routing functions correctly.

---

# Issue 5 – Branch Admin Activity Logs Access

## Current Behavior

Branch admins cannot access Activity Logs.

The Activity Logs tab is either missing or inaccessible.

## Expected Behavior

Branch admins should have access to Activity Logs according to pre-consolidation behavior.

## Required Work

* Compare permissions before and after auth consolidation.
* Restore Activity Logs tab visibility.
* Restore Activity Logs API access.
* Verify authorization policies remain secure.

---

# Issue 6 – Citizen Registration Verification Failure

## Current Behavior

Citizen registration fails during verification.

Frontend:

```text
The verification code has expired.
Please request a new one.
```

Backend:

```text
POST /api/auth/unified/verification/confirm
400 Bad Request
```

## Expected Behavior

Valid verification codes should successfully complete registration.

## Required Work

Investigate:

* Verification code generation
* Verification code storage
* Expiration calculations
* Timezone handling
* Unified auth migration changes
* Verification lookup logic

Verify:

* Registration works end-to-end.
* Verification succeeds before expiration.
* Expired codes fail correctly.
* New verification requests function properly.

---

# Root Cause Investigation

The auth consolidation appears to have unintentionally removed or overridden functionality previously implemented by other contributors.

Conduct a regression analysis comparing:

* Current unified authentication implementation
* Behavior from the last known working state (#248)

Focus on:

* Authorization
* Session handling
* Role resolution
* Dashboard routing
* Verification workflows
* Branch management workflows
* Citizen authentication

---

# Deliverables

For each issue provide:

## 1. Root Cause

Explain what caused the regression.

## 2. Code Changes

List all modified files and the purpose of each change.

## 3. Validation

Show how the fix was tested.

Include:

* API tests
* Workflow tests
* UI validation
* Role-specific validation

## 4. Regression Check

Confirm that the fix:

* Preserves unified authentication.
* Does not reintroduce fragmented auth.
* Does not break existing Superadmin/Admin functionality.
* Does not break security controls.

---

# Success Criteria

The implementation is complete only when:

* Full-path startup disclosure is removed.
* Superadmin Manage button immediately enters branch context.
* Return-to-Superadmin workflow functions correctly.
* All hashed placeholders are replaced with actual display values.
* Citizens can log in successfully.
* Citizens can register and verify successfully.
* Branch admins can access Activity Logs.
* Unified authentication remains the sole authentication architecture.
* All restored functionality matches pre-consolidation behavior.
