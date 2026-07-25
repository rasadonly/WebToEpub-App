import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Radix/manual fullscreen modals can occasionally leave body locks behind after
// closing. That freezes clicks or page scroll. Watch <body> and clear stale
// locks only when no overlay/menu/dialog is still open.
if (typeof window !== 'undefined') {
  const clearStaleBodyLocks = () => {
    const hasOpenOverlay = document.querySelector(
      '[data-state="open"][role="dialog"], [data-state="open"][role="menu"], [data-state="open"][role="alertdialog"], [aria-modal="true"], [class*="fixed"][class*="inset-0"][class*="z-[100]"]'
    );

    if (hasOpenOverlay) return;

    if (document.body.style.pointerEvents === 'none') {
      document.body.style.pointerEvents = '';
    }

    if (document.body.style.overflow === 'hidden') {
      document.body.style.overflow = '';
    }
  };

  const scheduleUnlockCheck = () => {
    clearStaleBodyLocks();
    window.setTimeout(clearStaleBodyLocks, 80);
    window.setTimeout(clearStaleBodyLocks, 250);
  };

  const observer = new MutationObserver(scheduleUnlockCheck);
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['style'],
    childList: true,
    subtree: true,
  });
  // Safety net: also check after overlay close animations and focus changes.
  window.addEventListener('focus', scheduleUnlockCheck);
  window.addEventListener('click', scheduleUnlockCheck, true);
  window.addEventListener('wheel', scheduleUnlockCheck, { passive: true, capture: true });
  window.addEventListener('touchstart', scheduleUnlockCheck, { passive: true, capture: true });
  document.addEventListener('visibilitychange', scheduleUnlockCheck);
}

createRoot(document.getElementById("root")!).render(<App />);

