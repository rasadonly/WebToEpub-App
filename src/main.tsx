import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Radix (Dialog / DropdownMenu / Popover) and our own full-screen modals lock
// scroll by setting `overflow: hidden` and `pointer-events: none` on <body>,
// and sometimes a `data-scroll-locked` attribute. In rare unmount races those
// locks stay behind after the overlay closes, freezing scroll and clicks.
// This safety net removes stale locks whenever there is no visibly-open modal.
if (typeof window !== 'undefined') {
  const isOverlayActuallyOpen = () => {
    // Any element that's currently marked open AND still attached
    const candidates = document.querySelectorAll(
      '[data-state="open"][role="dialog"],' +
      '[data-state="open"][role="alertdialog"],' +
      '[data-state="open"][role="menu"],' +
      '[data-state="open"][data-radix-menu-content],' +
      '[data-state="open"][data-radix-popper-content-wrapper],' +
      '[data-state="open"][data-radix-popover-content],' +
      '[aria-modal="true"]'
    );
    for (const el of Array.from(candidates)) {
      // Ignore trigger buttons that also carry data-state
      const tag = el.tagName.toLowerCase();
      if (tag === 'button') continue;
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return true;
    }
    // Our own fullscreen modals set inline `position: fixed; inset: 0; z-index`
    const fs = document.querySelector('[data-fullscreen-modal="true"]');
    if (fs) return true;
    return false;
  };

  const clearStaleBodyLocks = () => {
    if (isOverlayActuallyOpen()) return;
    const body = document.body;
    const html = document.documentElement;
    // Clear inline styles set by Radix scroll lock
    if (body.style.pointerEvents === 'none') body.style.pointerEvents = '';
    if (body.style.overflow === 'hidden') body.style.overflow = '';
    if (html.style.overflow === 'hidden') html.style.overflow = '';
    // Clear data attributes used by Radix/vaul scroll lock
    if (body.hasAttribute('data-scroll-locked')) body.removeAttribute('data-scroll-locked');
    if (html.hasAttribute('data-scroll-locked')) html.removeAttribute('data-scroll-locked');
    // Clear any margin-right padding injected for scrollbar compensation
    if (body.style.marginRight) body.style.marginRight = '';
    if (html.style.marginRight) html.style.marginRight = '';
  };

  let scheduled = false;
  const scheduleUnlockCheck = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      clearStaleBodyLocks();
    });
    window.setTimeout(clearStaleBodyLocks, 50);
    window.setTimeout(clearStaleBodyLocks, 150);
    window.setTimeout(clearStaleBodyLocks, 500);
  };

  // Watch both body AND html for lock attributes
  const observer = new MutationObserver(scheduleUnlockCheck);
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['style', 'data-scroll-locked'],
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'data-scroll-locked'],
  });
  // Watch for modal children being added/removed
  const treeObserver = new MutationObserver(scheduleUnlockCheck);
  treeObserver.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('focus', scheduleUnlockCheck);
  window.addEventListener('click', scheduleUnlockCheck, true);
  window.addEventListener('pointerdown', scheduleUnlockCheck, true);
  window.addEventListener('keyup', scheduleUnlockCheck, true);
  window.addEventListener('wheel', scheduleUnlockCheck, { passive: true, capture: true });
  window.addEventListener('touchstart', scheduleUnlockCheck, { passive: true, capture: true });
  document.addEventListener('visibilitychange', scheduleUnlockCheck);

  // Periodic safety sweep — cheap: no work when no lock is set.
  window.setInterval(() => {
    const body = document.body;
    const html = document.documentElement;
    if (
      body.style.overflow === 'hidden' ||
      body.style.pointerEvents === 'none' ||
      body.hasAttribute('data-scroll-locked') ||
      html.hasAttribute('data-scroll-locked')
    ) {
      clearStaleBodyLocks();
    }
  }, 300);
}

createRoot(document.getElementById("root")!).render(<App />);
