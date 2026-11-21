import { useEffect } from 'react';

// Escape closes the topmost open popup anywhere in the app. Native <dialog> elements
// already close themselves, and components that handle Escape call preventDefault,
// so this only acts for custom overlays/dialogs that would otherwise ignore the key.
const POPUP = '[role="dialog"], [aria-modal="true"], [class*="overlay"], [class*="modal"]';
const CLOSE = 'button[aria-label*="סגיר"], button[aria-label*="סגור"], button[title*="סגיר"], button[title*="סגור"], button[aria-label="Close"], [data-close], .modal-close, .close-btn, .zoki-brain-panel > header > button';

export function topmostPopup(root = document) {
  const visible = [...root.querySelectorAll(POPUP)].filter(element => {
    if (element.closest('dialog')) return false;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0 && ['fixed', 'absolute'].includes(style.position);
  });
  const z = element => Number.parseInt(getComputedStyle(element).zIndex, 10) || 0;
  return visible.sort((a, b) => z(a) - z(b)).at(-1) || null;
}

export function closePopup(popup) {
  const button = popup.querySelector(CLOSE) || popup.closest('[class*="overlay"]')?.querySelector(CLOSE);
  if (button) { button.click(); return true; }
  // Overlay backdrops usually close on a click that lands on the backdrop itself.
  const backdrop = popup.matches('[class*="overlay"]') ? popup : popup.closest('[class*="overlay"]');
  if (backdrop) { backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; }
  return false;
}

export function useGlobalEscape() {
  useEffect(() => {
    const onKey = event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const popup = topmostPopup();
      if (popup && closePopup(popup)) event.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}
