import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Radix Dialog occasionally leaves `pointer-events: none` on <body> after
// closing (especially when opened from inside a DropdownMenu). That freezes
// every button on the page. Watch <body> and clear it as soon as it appears.
if (typeof window !== 'undefined') {
  const clearBodyPointerEvents = () => {
    if (document.body.style.pointerEvents === 'none') {
      const hasOpenOverlay = document.querySelector(
        '[data-state="open"][role="dialog"], [data-state="open"][role="menu"], [data-state="open"][role="alertdialog"]'
      );
      if (!hasOpenOverlay) {
        document.body.style.pointerEvents = '';
      }
    }
  };
  const observer = new MutationObserver(clearBodyPointerEvents);
  observer.observe(document.body, { attributes: true, attributeFilter: ['style'] });
  // Safety net: also poll on focus/visibility changes.
  window.addEventListener('focus', clearBodyPointerEvents);
  document.addEventListener('visibilitychange', clearBodyPointerEvents);
}

createRoot(document.getElementById("root")!).render(<App />);

