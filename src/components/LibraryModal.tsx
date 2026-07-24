import { useEffect, useRef, useState } from 'react';
import { X, BookMarked, Cloud, Archive, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface LibraryModalProps {
  open: boolean;
  onClose: () => void;
}

type Tab = 'library' | 'mega' | 'reading';

/**
 * Native-looking Library shell that hosts the WebToEpub library engine
 * (Library, HFLibrary, MegaLibrary, ArchiveLibrary, ReadingList + LibraryUI)
 * inside a hidden iframe served from our own /public folder. The iframe's
 * chrome is hidden via injected CSS so only the requested library section
 * is visible — the user never leaves our app or sees WebToEpub branding.
 */
export function LibraryModal({ open, onClose }: LibraryModalProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [tab, setTab] = useState<Tab>('library');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReady(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Switch which section of the embedded engine is visible.
  useEffect(() => {
    if (!open || !ready) return;
    applyTab(tab);
  }, [tab, open, ready]);

  const applyTab = (t: Tab) => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const hiddenBib = doc.getElementById('hiddenBibSection') as HTMLElement | null;
    const libTmpl = doc.getElementById('LibraryTemplate') as HTMLElement | null;
    const megaSec = doc.getElementById('megaLibrarySection') as HTMLElement | null;
    const readingSec = doc.getElementById('readingListSection') as HTMLElement | null;

    [hiddenBib, libTmpl, megaSec, readingSec].forEach((el) => {
      if (el) el.hidden = true;
    });

    if (t === 'library') {
      if (hiddenBib) hiddenBib.hidden = false;
      if (libTmpl) libTmpl.hidden = false;
      // Trigger library button so LibraryUI populates
      const btn = doc.getElementById('hiddenBibButton') as HTMLButtonElement | null;
      if (btn && !btn.dataset.wteClicked) {
        btn.dataset.wteClicked = '1';
        btn.click();
      }
    } else if (t === 'mega') {
      if (megaSec) megaSec.hidden = false;
      const mbtn = doc.getElementById('megaLibraryButton') as HTMLButtonElement | null;
      if (mbtn && !mbtn.dataset.wteClicked) {
        mbtn.dataset.wteClicked = '1';
        mbtn.style.display = '';
        mbtn.click();
      }
    } else if (t === 'reading') {
      if (readingSec) readingSec.hidden = false;
    }
  };

  const handleLoad = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;

    // Inject CSS that hides everything that's not the library shell.
    const style = doc.createElement('style');
    style.textContent = `
      body { background: transparent !important; margin: 0 !important; padding: 12px !important; font-family: Figtree, system-ui, sans-serif !important; }
      .app-header, header.app-header { display: none !important; }
      #inputSection, #outputSection, #imageSection, #testSection,
      #searchEngineSection, #sbFilters, #advancedOptionsSection,
      #defaultParserSection, #errorSection { display: none !important; }
      .HiddenButtonSection { display: none !important; }
      .container { max-width: 100% !important; padding: 0 !important; }
      button { cursor: pointer; }
      input, select, textarea, button { font-family: inherit !important; }
    `;
    doc.head.appendChild(style);

    // Poll until engine libs are ready, then apply current tab.
    let tries = 0;
    const poll = () => {
      const w = iframeRef.current?.contentWindow as any;
      if (w && (w.Library || w.__WTE_READY)) {
        setReady(true);
        applyTab(tab);
        return;
      }
      if (++tries > 60) {
        setReady(true);
        applyTab(tab);
        return;
      }
      setTimeout(poll, 200);
    };
    poll();
  };

  if (!open) return null;

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: 'library', label: 'Library', icon: BookMarked },
    { id: 'mega', label: 'Mega Cloud', icon: Cloud },
    { id: 'reading', label: 'Reading List', icon: Archive },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-6xl h-[90vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="font-display text-lg font-semibold">Your Library</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="flex gap-1 px-3 pt-3 border-b border-border">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg transition-colors',
                tab === id
                  ? 'bg-background text-foreground border border-b-0 border-border'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 bg-background">
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading library…
            </div>
          )}
          <iframe
            ref={iframeRef}
            onLoad={handleLoad}
            src="/webtoepub/plugin/popup.html?wte=1"
            title="Library"
            className="w-full h-full bg-background"
          />
        </div>
      </div>
    </div>
  );
}
