# WARDS XSS Security Regression Checklist

Run this checklist before every release that touches uploads, previews, announcements, memos, guides, reports, or payment flows.

## 1. File Upload Validation

- [ ] Upload a file with `.pdf` extension but containing HTML/JS — backend must reject with "unrecognized or unsupported file format"
- [ ] Upload a file with `.png` extension but containing HTML/JS — backend must reject
- [ ] Upload a file with `.jpg` extension but containing HTML/JS — backend must reject
- [ ] Upload a legitimate PDF — must succeed, MIME type stored as `application/pdf`
- [ ] Upload a legitimate PNG — must succeed, MIME type stored as `image/png`
- [ ] Upload a legitimate JPEG — must succeed, MIME type stored as `image/jpeg`
- [ ] Upload a renamed SVG with `.pdf` extension — backend must reject
- [ ] Upload DOCX, XLSX, TXT, CSV, JSON — backend must reject (allowlist is PDF/PNG/JPEG only)
- [ ] Upload a zero-byte file — backend must reject
- [ ] Upload a file > 25 MB to announcements — backend must reject
- [ ] Upload a file > 10 MB to tax assessment — backend must reject

## 2. File Preview / Inline Rendering

- [ ] Open a verified PDF attachment — preview opens in sandboxed iframe, no script execution
- [ ] Open a verified PNG/JPEG attachment — preview renders as `<img>`, no iframe used
- [ ] Attempt to open an SVG file (if stored before hardening) — forced to download, no inline preview
- [ ] Attempt to open a TXT file (if stored before hardening) — forced to download
- [ ] Attempt to open an HTML file (if stored before hardening) — forced to download, never rendered as `text/html`
- [ ] Preview response headers contain `X-Content-Type-Options: nosniff`
- [ ] Non-previewable types receive `Content-Disposition: attachment`

## 3. CSP and Response Headers

- [ ] Every HTML response includes `Content-Security-Policy` header
- [ ] Production CSP has `script-src 'self'` (no `unsafe-inline`, no `unsafe-eval`)
- [ ] Production CSP has `style-src 'self' 'unsafe-inline'` (required for React style prop)
- [ ] Production CSP has `object-src 'none'`
- [ ] Production CSP has `frame-ancestors 'none'`
- [ ] Every response includes `X-Content-Type-Options: nosniff`
- [ ] Every response includes `X-Frame-Options: DENY` or `SAMEORIGIN`
- [ ] No `text/html` is served for user-uploaded files

## 4. HTML Template / Blob URL Flows

- [ ] Payment checkout loading page (`PayTaxesRPT`, `RequestReceipt`) uses static localized text only
- [ ] Queue ticket print HTML escapes all dynamic values via `escapeHtml()`
- [ ] Collection report HTML escapes all branch names, remittedBy, verifiedBy via `escapeHtml()`
- [ ] No `innerHTML`, `document.write`, or `dangerouslySetInnerHTML` is used with user data
- [ ] Report preview iframe is sandboxed (`sandbox=""`)
- [ ] File preview iframe is sandboxed (`sandbox=""`) for PDFs

## 5. URL Navigation and Links

- [ ] No `javascript:` URLs are accepted in any URL input field
- [ ] All external links use `rel="noopener noreferrer"`
- [ ] Payment redirect URLs are validated against an allowlist

## 6. Rich Text / Announcement Content

- [ ] Any HTML-rendered announcement content passes through the shared DOMPurify utility
- [ ] DOMPurify config forbids `script`, `iframe`, `object`, `embed`, `link`, `form`, `input`, `meta`, `base`, `style`
- [ ] No ad-hoc HTML parsing or rendering exists outside the shared sanitizer

## 7. Payload Test Strings

Try these exact strings in any text input that may be rendered back:

```
<script>alert('xss')</script>
<img src=x onerror=alert('xss')>
<svg onload=alert('xss')>
javascript:alert('xss')
"><script>alert('xss')</script>
' onmouseover='alert("xss")
```

Expected: all rendered as plain text or escaped, never executed.

## 8. Third-Party and Stored Content

- [ ] OCR output is rendered as plain text, never as HTML
- [ ] Payment provider responses are rendered as text, not executed
- [ ] Imported records are validated before display
- [ ] Attachment metadata (filename, uploaded_by) is escaped before rendering

## 9. iframe Audit

| iframe | Purpose | sandboxed? | Can it be eliminated? |
|--------|---------|-----------|----------------------|
| FileViewerModal (PDF) | File preview | Yes | No — PDF requires iframe |
| ReceiptManagement print | Print receipt | No (breaks print) | No — print-only, DOM-built content |
| Queue ticket print | Print ticket | Yes (hidden) | No — srcdoc-based, no blob |

- [ ] No new iframes are added without sandboxing
- [ ] No iframe is used to render user-uploaded content except sandboxed PDF

## 10. Blob URL Discipline

- [ ] No `new Blob([...], { type: 'text/html' })` exists outside `safeBlob.js`
- [ ] All Blob URLs are created via `createSafeBlobUrl` with a `purpose` description
- [ ] Queue ticket print uses iframe `srcdoc`, not `URL.createObjectURL(blob)`
- [ ] PaymentManagement report preview uses React DOM, not iframe blob
- [ ] Report print window (for physical printing) still uses blob but content is app-generated only

## 11. Endpoint Separation

- [ ] Preview endpoints use `allow_inline_preview=True` only for verified PDF/PNG/JPEG
- [ ] Download endpoints always force `Content-Disposition: attachment`
- [ ] All file responses use `deliver_file_response` or `deliver_bytes_response`
- [ ] All file responses include `X-Content-Type-Options: nosniff`

## 12. Regression Test Commands

```bash
# Run backend file signature tests
cd backend
python -m pytest tests/ -k "upload" -v

# Run frontend CSP header checks
curl -I http://localhost:8000/ | grep -i "content-security-policy"
curl -I http://localhost:8000/ | grep -i "x-content-type-options"
curl -I http://localhost:8000/ | grep -i "x-frame-options"

# Verify file delivery headers
curl -I http://localhost:8000/api/announcements/1/attachments/1/preview | grep -i "x-content-type-options"
curl -I http://localhost:8000/api/announcements/1/attachments/1/preview | grep -i "content-disposition"
```

---

**Sign-off:** _________________  **Date:** _________________
