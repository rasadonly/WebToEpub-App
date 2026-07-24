import { useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LiveReaderModalProps {
  url?: string;
  open: boolean;
  onClose: () => void;
}

/**
 * Fullscreen overlay that embeds the vendored WebToEpub Live Reader.
 * The reader is a self-contained page at /webtoepub/live-reader.html and
 * accepts a ?url= query param to auto-load a novel.
 */
export function LiveReaderModal({ url, open, onClose }: LiveReaderModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  const src = url
    ? `/webtoepub/live-reader.html?url=${encodeURIComponent(url)}`
    : `/webtoepub/live-reader.html`;

  return (
    <div className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-sm flex flex-col animate-in fade-in duration-200">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/80">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold">Live Reader</span>
          {url && (
            <span className="text-xs text-muted-foreground truncate max-w-[60vw]">{url}</span>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="gap-1"
        >
          <X className="w-4 h-4" /> Close
        </Button>
      </div>
      <iframe
        key={src}
        src={src}
        title="Live Reader"
        className="flex-1 w-full border-0 bg-background"
        allow="clipboard-write; fullscreen"
      />
    </div>
  );
}
