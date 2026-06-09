/**
 * Queue Ticket Print Utility
 *
 * Prints the element marked with [data-print-ticket] using the browser’s
 * native print dialog. This avoids hidden iframes, blob URLs, and mini
 * HTML documents entirely.
 */

const INJECTED_PRINT_STYLE_ID = 'wards-print-ticket-style';

/**
 * printQueueTicket
 *
 * Prints the element marked with [data-print-ticket] using the browser’s
 * native print dialog. This avoids hidden iframes, blob URLs, and mini
 * HTML documents entirely.
 *
 * The caller must place `data-print-ticket` on the container that should
 * be printed (e.g. the modal ticket card or the success-page ticket card).
 */
export const printQueueTicket = ({ targetSelector = '[data-print-ticket]' } = {}) => {
  const target = document.querySelector(targetSelector);
  if (!target) {
    // eslint-disable-next-line no-console
    console.warn(`[printQueueTicket] No element found for selector "${targetSelector}"`);
    return false;
  }

  // Remove any previously injected print style
  const existing = document.getElementById(INJECTED_PRINT_STYLE_ID);
  if (existing) existing.remove();

  const style = document.createElement('style');
  style.id = INJECTED_PRINT_STYLE_ID;
  style.textContent = `
    @media print {
      body * { visibility: hidden !important; }
      ${targetSelector}, ${targetSelector} * { visibility: visible !important; }
      ${targetSelector} {
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
        width: 100% !important;
        background: white !important;
        padding: 20px !important;
      }
    }
  `;
  document.head.appendChild(style);

  const cleanup = () => {
    const s = document.getElementById(INJECTED_PRINT_STYLE_ID);
    if (s) s.remove();
  };

  window.onafterprint = cleanup;
  setTimeout(cleanup, 60000);

  window.print();
  return true;
};
