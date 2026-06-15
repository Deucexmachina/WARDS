const POPUP_LOADING_SHELL_STYLES = 'body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;color:#1f2937;}';

/**
 * Opens a same-origin blank popup and renders a minimal loading shell with
 * safe DOM APIs only. The opener reference is explicitly cleared before the
 * popup is redirected to an external payment provider.
 *
 * @param {Object} options
 * @param {string} options.name
 * @param {string} options.title
 * @param {string} options.heading
 * @param {string} options.description
 * @returns {Window|null}
 */
export const openCheckoutPopupShell = ({
  name,
  title,
  heading,
  description,
}) => {
  const popup = window.open('', name);
  if (!popup) {
    return null;
  }

  try {
    popup.opener = null;
  } catch (error) {
    // Some browsers treat opener as read-only; continue with the safe shell.
  }

  const doc = popup.document;
  doc.title = title;

  const style = doc.createElement('style');
  style.textContent = POPUP_LOADING_SHELL_STYLES;
  doc.head.appendChild(style);

  const container = doc.createElement('div');
  container.style.cssText = 'text-align:center;max-width:420px;padding:24px;';

  const headingNode = doc.createElement('h2');
  headingNode.style.marginBottom = '12px';
  headingNode.textContent = heading;

  const descriptionNode = doc.createElement('p');
  descriptionNode.style.lineHeight = '1.5';
  descriptionNode.textContent = description;

  container.appendChild(headingNode);
  container.appendChild(descriptionNode);
  doc.body.appendChild(container);

  return popup;
};
