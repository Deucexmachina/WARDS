---
description: XSS Security Review Checklist for code changes
---

# XSS Security Review Workflow

Run this checklist for every PR that touches uploads, file previews, announcements,
memos, reports, receipts, payments, queues, or any feature that renders user-provided
or external data.

## 1. New Rendering Sinks

- [ ] **Does this change introduce a new way to render HTML?**
  - New iframe, popup window, blob URL, `innerHTML`, `document.write`, `dangerouslySetInnerHTML`
  - New markdown/rich-text rendering path
  - New PDF or image preview mechanism
  - New report, receipt, ticket, or statement template
- [ ] If YES, the implementation must use ONE of these approved patterns:
  - **React DOM rendering** (preferred for previews)
  - **Hidden iframe with `srcdoc`** (preferred for print-only content, sandboxed)
  - **Backend-generated PDF** (for official documents)
  - **DOMPurify via `sanitizeHtml`** (only if rich text is genuinely required)

## 2. Data Sources

Treat ALL of the following as untrusted by default:

- [ ] User form inputs (names, addresses, descriptions, filenames)
- [ ] File uploads (names, content types, metadata)
- [ ] OCR output text
- [ ] Payment provider responses and webhooks
- [ ] Imported CSV/Excel records
- [ ] Branch names, staff names, and system-generated messages stored in the database
- [ ] Query parameters and URL path segments

## 3. Interpolation & Escaping

- [ ] Every value interpolated into an HTML string is escaped.
- [ ] Every value rendered in JSX is passed as JSX text/attribute (React auto-escapes).
- [ ] Numeric/currency values are formatted before display.
- [ ] Date values are formatted before display.
- [ ] URLs are validated through `sanitizeUrl` before use in `href` or `src`.

## 4. File Handling

- [ ] New upload endpoints use `validate_upload_file` from `utils/file_validation.py`.
- [ ] New file delivery endpoints use `deliver_file_response` or `deliver_bytes_response` from `utils/file_delivery.py`.
- [ ] Only PDF, PNG, and JPEG are allowed for upload.
- [ ] Preview endpoints set `allow_inline_preview=True` ONLY for verified safe MIME types.
- [ ] Download endpoints always force `Content-Disposition: attachment`.
- [ ] All file responses include `X-Content-Type-Options: nosniff`.

## 5. iframe Discipline

- [ ] Any new iframe must have `sandbox=""` (empty sandbox = most restrictive).
- [ ] No iframe gets `allow-scripts` or `allow-same-origin` exceptions without a
      documented security review in the PR.
- [ ] iframe `src` must never point to a user-uploaded file directly.

## 6. Blob URL Discipline

- [ ] Any new `new Blob([...], { type: 'text/html' })` must go through `createSafeBlobUrl`
      in `frontend/src/utils/safeBlob.js`.
- [ ] The `purpose` argument must describe what the blob is for.
- [ ] If the blob type is not in the allowlist, add it only after security review.

## 7. CSP Compliance

- [ ] No inline `<script>` tags or inline `on*` event handlers in generated HTML.
- [ ] No `eval()` or `Function()` constructor usage.
- [ ] No external scripts loaded from CDN or third-party domains.

## 8. Regression Testing

Before merging, verify with at least these payloads in any new text input:

```
<script>alert(1)</script>
<img src=x onerror=alert(1)>
<svg onload=alert(1)>
javascript:alert(1)
"><script>alert(1)</script>
```

Expected: rendered as plain text, never executed.

## 9. Sign-off

| Reviewer | Date | Notes |
|----------|------|-------|
|          |      |       |
