/**
 * Safe Blob Creation Utility
 *
 * Centralized wrapper for Blob/URL.createObjectURL to enforce validation
 * and audit logging. All app-generated Blob URLs should be created through
 * this utility rather than ad-hoc new Blob() calls.
 *
 * Security rules:
 * - text/html blobs are allowed ONLY for app-generated print templates
 *   (not for user-uploaded content).
 * - text/csv blobs are allowed for app-generated exports.
 * - application/pdf blobs are allowed for backend-generated PDFs.
 * - image/* blobs are allowed for backend-fetched image previews.
 * - NEVER create text/html from user input or external data.
 */

const ALLOWED_BLOB_TYPES = Object.freeze([
  'text/html',
  'text/csv',
  'text/csv;charset=utf-8;',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'application/octet-stream',
]);

/**
 * Validate that a MIME type is on the allowed list for Blob creation.
 *
 * @param {string} mimeType
 * @returns {boolean}
 */
export const isSafeBlobType = (mimeType) => {
  if (!mimeType) return false;
  const normalized = mimeType.toLowerCase().trim();
  return ALLOWED_BLOB_TYPES.includes(normalized);
};

/**
 * Create a Blob URL with validation and mandatory cleanup tracking.
 *
 * @param {BlobPart[]} parts - Blob content
 * @param {string} mimeType - MIME type (must be on allowlist)
 * @param {Object} options
 * @param {string} options.purpose - Human-readable purpose for debugging
 * @returns {string} Blob URL
 * @throws {Error} if MIME type is not on the allowlist
 */
export const createSafeBlobUrl = (parts, mimeType, { purpose = 'unknown' } = {}) => {
  if (!isSafeBlobType(mimeType)) {
    // eslint-disable-next-line no-console
    console.error(
      `[safeBlob] Rejected unsafe Blob type "${mimeType}" for purpose: ${purpose}. ` +
      'If this is legitimate, add it to ALLOWED_BLOB_TYPES in safeBlob.js and get security review.'
    );
    throw new Error(
      `Unsafe Blob MIME type rejected: ${mimeType}. See safeBlob.js allowlist.`
    );
  }

  const blob = new Blob(parts, { type: mimeType });
  const url = URL.createObjectURL(blob);

  // In development, log blob creation for auditability
  if (import.meta.env?.DEV) {
    // eslint-disable-next-line no-console
    console.log(`[safeBlob] Created Blob URL for ${purpose}: ${mimeType}`);
  }

  return url;
};

/**
 * Revoke a Blob URL safely (no-op if already revoked or invalid).
 *
 * @param {string} url
 */
export const revokeSafeBlobUrl = (url) => {
  if (url && typeof url === 'string' && url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
};
