/**
 * URL Validation Utility
 * 
 * Validates URLs to prevent XSS attacks via javascript:, data:, vbscript: schemes.
 * Follows OWASP XSS Prevention Cheat Sheet recommendations.
 * 
 * @module urlValidator
 */

/**
 * Validates that a URL is safe for use in navigation or href attributes.
 * Allows same-origin relative paths plus http:// and https:// schemes.
 * Rejects javascript:, data:, vbscript:, and malformed URLs.
 * 
 * @param {string} url - The URL string to validate
 * @returns {boolean} - True if the URL is safe, false otherwise
 */
export const isSafeUrl = (url) => {
  if (!url || typeof url !== 'string') {
    return false;
  }

  if (url.startsWith('/') && !url.startsWith('//')) {
    return true;
  }

  try {
    const parsed = new URL(url);
    
    // Only allow http and https schemes
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    
    // Ensure there's a hostname present
    if (!parsed.hostname) {
      return false;
    }
    
    return true;
  } catch (error) {
    // Malformed URL
    return false;
  }
};

/**
 * Sanitizes a URL for safe use in navigation.
 * Returns null if the URL is unsafe.
 * 
 * @param {string} url - The URL string to sanitize
 * @returns {string|null} - The original URL if safe, null otherwise
 */
export const sanitizeUrl = (url) => {
  if (isSafeUrl(url)) {
    return url;
  }
  return null;
};

/**
 * Safely navigates to a URL after validation.
 * Returns true if navigation was performed, false otherwise.
 * 
 * @param {string} url - The URL to navigate to
 * @param {Window} [windowObj=window] - The window object to use (for testing)
 * @returns {boolean} - True if navigation was performed
 */
export const safeNavigate = (url, windowObj = window) => {
  if (isSafeUrl(url)) {
    if (url.startsWith('/') && !url.startsWith('//')) {
      windowObj.location.assign(url);
    } else {
      windowObj.location.href = url;
    }
    return true;
  }
  console.error('Unsafe URL blocked:', url);
  return false;
};

/**
 * Safely replaces the current location with a URL after validation.
 * Returns true if navigation was performed, false otherwise.
 * 
 * @param {string} url - The URL to navigate to
 * @param {Window} [windowObj=window] - The window object to use (for testing)
 * @returns {boolean} - True if navigation was performed
 */
export const safeReplace = (url, windowObj = window) => {
  if (isSafeUrl(url)) {
    if (url.startsWith('/') && !url.startsWith('//')) {
      windowObj.location.replace(url);
    } else {
      windowObj.location.replace(url);
    }
    return true;
  }
  console.error('Unsafe URL blocked:', url);
  return false;
};

/**
 * Safely opens a URL in a new window after validation.
 * Returns true if window was opened, false otherwise.
 * 
 * @param {string} url - The URL to open
 * @param {string} [windowName='_blank'] - The window name
 * @param {string} [windowFeatures='noopener,noreferrer'] - Window features
 * @param {Window} [windowObj=window] - The window object to use (for testing)
 * @returns {Window|null} - The new window object if opened, null otherwise
 */
export const safeOpen = (url, windowName = '_blank', windowFeatures = 'noopener,noreferrer', windowObj = window) => {
  if (isSafeUrl(url)) {
    return windowObj.open(url, windowName, windowFeatures);
  }
  console.error('Unsafe URL blocked:', url);
  return null;
};
