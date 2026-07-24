import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LibraryModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Embeds the WebToEpub plugin popup so every library feature
 * (ReadingList, HuggingFace, Mega, Archive.org) works identically
 * to the upstream extension. The iframe scrolls to the Library
 * section on load.
 */
export function LibraryModal({ open, onClose }: LibraryModalProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleLoad = () => {
    const win = iframeRef.current?.contentWindow as any;
    const doc = iframeRef.current?.contentDocument;
    if (!win || !doc) return;
    // Scroll to the library UI section
    const target =
      doc.getElementById('LibraryTemplate') ||
      doc.getElementById('hiddenBibButton') ||
      doc.getElementById('megaLibrarySection');
    try {
      // Reveal library template if hidden
      const tmpl = doc.getElementById('LibraryTemplate') as HTMLElement | null;
      if (tmpl) tmpl.hidden = false;
      target?.scrollIntoView({ behavior: 'auto', block: 'start' });
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-6xl h-[90vh] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
          <h2 className="font-display text-lg font-semibold">Library</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>
        <iframe
          ref={iframeRef}
          onLoad={handleLoad}
          src="/webtoepub/plugin/popup.html?wte=1#LibraryTemplate"
          title="Library"
          className="flex-1 w-full bg-background"
        />
      </div>
    </div>
  );
}
