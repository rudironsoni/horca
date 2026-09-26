'use strict';

const PREEDIT_ATTR = 'data-horca-ghostty-preedit';

function syncGhosttyPreedit(document, canvas, text) {
  if (!document || typeof document.createElement !== 'function' || !document.body || !canvas) {
    return null;
  }
  const shown = String(text || '');
  const existing = document.querySelector(`[${PREEDIT_ATTR}]`);
  if (!shown) {
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    return null;
  }
  const node = existing || document.createElement('div');
  if (!existing) {
    node.setAttribute(PREEDIT_ATTR, '');
    node.setAttribute('aria-hidden', 'true');
    document.body.appendChild(node);
  }
  node.textContent = shown;
  const rect = canvas.getBoundingClientRect();
  const style = node.style;
  style.position = 'fixed';
  style.left = `${rect.left || 0}px`;
  style.top = `${rect.top || 0}px`;
  style.width = `${Math.max(8, shown.length * 8)}px`;
  style.height = '16px';
  style.overflow = 'hidden';
  style.pointerEvents = 'none';
  style.zIndex = '20';
  return node;
}

module.exports = { syncGhosttyPreedit, PREEDIT_ATTR };
