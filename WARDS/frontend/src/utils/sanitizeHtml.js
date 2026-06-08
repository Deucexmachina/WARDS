/**
 * HTML Sanitization Utility
 * 
 * Provides DOMPurify-based HTML sanitization to prevent XSS attacks.
 * Follows OWASP XSS Prevention Cheat Sheet recommendations.
 * 
 * @module sanitizeHtml
 */

import DOMPurify from 'dompurify';

/**
 * Default DOMPurify configuration for strict XSS prevention.
 * Blocks dangerous tags and attributes while allowing safe HTML.
 */
const DEFAULT_CONFIG = {
  // Forbidden tags that can execute scripts or load external resources
  FORBID_TAGS: [
    'script',
    'iframe',
    'object',
    'embed',
    'link',
    'meta',
    'form',
    'input',
    'button',
    'select',
    'textarea',
    'details',
    'dialog',
  ],
  // Forbidden attributes that can execute JavaScript
  FORBID_ATTR: [
    'onerror',
    'onclick',
    'onload',
    'onmouseover',
    'onfocus',
    'onmouseenter',
    'onmouseleave',
    'onkeydown',
    'onkeyup',
    'onkeypress',
    'onmousedown',
    'onmouseup',
    'onsubmit',
    'onchange',
    'onblur',
    'onfocusout',
    'onfocusin',
    'ondblclick',
    'oncontextmenu',
    'onwheel',
    'onscroll',
    'onresize',
    'onanimationend',
    'onanimationstart',
    'onanimationiteration',
    'ontransitionend',
    'ontransitionstart',
    'ontransitioncancel',
    'ontouchstart',
    'ontouchend',
    'ontouchmove',
    'ontouchcancel',
  ],
  // Allow data URIs for images (common use case)
  ALLOW_DATA_ATTR: false,
  // Allow only specific protocols
  ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
};

/**
 * Sanitizes HTML content to prevent XSS attacks.
 * 
 * @param {string} dirty - The potentially unsafe HTML string
 * @param {Object} [config] - Optional DOMPurify configuration overrides
 * @returns {string} - The sanitized, safe HTML string
 */
export const sanitizeHtml = (dirty, config = {}) => {
  if (typeof dirty !== 'string') {
    return '';
  }
  
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  return DOMPurify.sanitize(dirty, mergedConfig);
};

/**
 * Sanitizes HTML content and returns it, or empty string if null/undefined.
 * Convenience function for optional HTML content.
 * 
 * @param {string|null|undefined} dirty - The potentially unsafe HTML string
 * @param {Object} [config] - Optional DOMPurify configuration overrides
 * @returns {string} - The sanitized, safe HTML string (or empty string)
 */
export const sanitizeHtmlOptional = (dirty, config = {}) => {
  if (dirty == null) {
    return '';
  }
  return sanitizeHtml(dirty, config);
};

/**
 * Checks if HTML content is safe (contains no dangerous elements).
 * Returns true if the content is safe, false otherwise.
 * 
 * @param {string} dirty - The potentially unsafe HTML string
 * @returns {boolean} - True if safe, false if dangerous
 */
export const isHtmlSafe = (dirty) => {
  if (typeof dirty !== 'string') {
    return false;
  }
  
  const sanitized = DOMPurify.sanitize(dirty, DEFAULT_CONFIG);
  return sanitized === dirty;
};

export default sanitizeHtml;
