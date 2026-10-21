export type ReaderTheme = 'light' | 'dark' | 'sepia';

// EPUB documents have their own CSS cascade, so copy the app's semantic tokens
// into each chapter and update the same stylesheet whenever the theme changes.
export function applyReaderDocumentTheme(doc: Document, theme: ReaderTheme) {
  const tokens = getComputedStyle(document.documentElement);
  const token = (role: string) => tokens.getPropertyValue(`--reader-${theme}-${role}`).trim();
  let style = doc.getElementById('epub-reader-theme');
  if (!style) {
    style = doc.createElement('style');
    style.id = 'epub-reader-theme';
    doc.head.appendChild(style);
  }
  style.textContent = `
    :root {
      --reader-background: hsl(${token('background')});
      --reader-foreground: hsl(${token('foreground')});
      --reader-link: hsl(${token('link')});
    }
    html, body { background: var(--reader-background) !important; color: var(--reader-foreground) !important; }
    body * { color: var(--reader-foreground) !important; -webkit-text-fill-color: currentColor !important; background-color: transparent !important; }
    body a, body a * { color: var(--reader-link) !important; }
    .tts-current {
      background: hsl(${tokens.getPropertyValue('--reader-highlight').trim()} / 0.16) !important;
      box-shadow: -4px 0 0 hsl(${tokens.getPropertyValue('--reader-highlight').trim()} / 0.8) !important;
      padding-left: 8px !important;
      border-radius: 3px;
      transition: background 0.25s ease;
    }
  `;
  // Inline !important declarations outrank even the reader stylesheet.
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[style]'))) {
    for (const property of ['color', 'background', 'background-color', '-webkit-text-fill-color']) {
      el.style.removeProperty(property);
    }
  }
  const iframe = doc.defaultView?.frameElement as HTMLElement | null;
  if (iframe) iframe.style.background = `hsl(${token('background')})`;
}