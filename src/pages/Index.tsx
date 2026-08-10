import ConversionForm from '@/components/ConversionForm';
import ProgressLog from '@/components/ProgressLog';
import ChapterManager from '@/components/ChapterManager';
import { useEpubConverter } from '@/hooks/useEpubConverter';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { trackPageView } from '@/utils/analytics';

const Index = () => {
  const pageRef = useRef<HTMLDivElement>(null);
  const {
    progress,
    logs,
    chapterList,
    setChapterList,
    fetchChapters,
    generateFromChapters,
    resetConverter,
    stopConversion,
    isConverting,
    isGenerating,
    isFetchingToc,
    serverJob,
    downloadServerJob,

  } = useEpubConverter();

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;

    const isInsideOverlay = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      return Boolean(
        target.closest(
          '[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper], [data-fullscreen-modal="true"]'
        )
      );
    };

    const canElementScroll = (element: Element, deltaY: number) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const scrollable = /(auto|scroll|overlay)/.test(style.overflowY);
      if (!scrollable || element.scrollHeight <= element.clientHeight + 1) return false;
      if (deltaY > 0) return element.scrollTop + element.clientHeight < element.scrollHeight - 1;
      if (deltaY < 0) return element.scrollTop > 1;
      return false;
    };

    const hasScrollableAncestor = (target: EventTarget | null, deltaY: number) => {
      if (!(target instanceof Element)) return false;
      let node: Element | null = target;
      while (node && node !== page && node !== document.body) {
        if (canElementScroll(node, deltaY)) return true;
        node = node.parentElement;
      }
      return false;
    };

    const wheelToPixels = (event: WheelEvent) => {
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16;
      if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * window.innerHeight;
      return event.deltaY;
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || isInsideOverlay(event.target)) return;
      if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;

      const deltaY = wheelToPixels(event);
      if (deltaY === 0 || hasScrollableAncestor(event.target, deltaY)) return;

      const scroller = document.scrollingElement ?? document.documentElement;
      const maxScroll = scroller.scrollHeight - window.innerHeight;
      if (maxScroll <= 0) return;

      event.preventDefault();
      window.scrollBy({ top: deltaY, behavior: 'auto' });
    };

    page.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    return () => page.removeEventListener('wheel', handleWheel, { capture: true });
  }, []);

  useEffect(() => {
    trackPageView('/');
  }, []);

  return (
    <div
      ref={pageRef}
      className="min-h-screen bg-gradient-hero"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="container mx-auto px-3 sm:px-4 py-6 sm:py-10 space-y-6 sm:space-y-8 max-w-full">

        {/* Hero Section */}
        <div className="text-center max-w-2xl mx-auto mb-2">
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-3">
            Convert Web Novels to EPUB — Free, Instant, No Account
          </h1>
          <p className="text-muted-foreground text-base sm:text-lg mb-5">
            Paste a table-of-contents URL from Royal Road, NovelBin, Scribble Hub, or{' '}
            <Link to="/sites" className="text-primary hover:underline font-medium">380+ other sites</Link>{' '}
            and download a clean, device-ready EPUB in seconds.
          </p>
          {/* Differentiator badges */}
          <div className="flex flex-wrap justify-center gap-2 text-sm mb-5">
            {[
              '✅ Completely Free',
              '🚀 No Account Required',
              '📚 380+ Sites Supported',
              '📱 Works on Kindle & Kobo',
              '🔒 Privacy-First',
            ].map(badge => (
              <span key={badge} className="px-3 py-1 rounded-full bg-secondary text-secondary-foreground border border-border/60 font-medium">
                {badge}
              </span>
            ))}
          </div>
          <div className="flex justify-center gap-4 text-xs text-muted-foreground">
            <Link to="/guide" className="hover:text-primary transition-colors">How-to Guide</Link>
            <span>·</span>
            <Link to="/sites" className="hover:text-primary transition-colors">Supported Sites</Link>
            <span>·</span>
            <Link to="/privacy" className="hover:text-primary transition-colors">Privacy</Link>
          </div>
        </div>

        {/* Main Content */}
        <div className="space-y-6">
          <ConversionForm
            onSubmit={fetchChapters}
            isConverting={isConverting}
            hasFetchedChapters={!!(chapterList && chapterList.length > 0)}
          />
          {chapterList && chapterList.length > 0 && (
            <ChapterManager
              chapters={chapterList}
              onChange={setChapterList}
              onGenerate={generateFromChapters}
              isGenerating={isGenerating}
              isStreaming={isFetchingToc}
            />
          )}
          <ProgressLog
            progress={progress}
            logs={logs}
            onStop={stopConversion}
            serverJob={serverJob}
            onDownload={downloadServerJob}
          />

        </div>

        {/* Reset Button */}
        {(progress.status === 'complete' || progress.status === 'error') && (
          <div className="flex justify-center">
            <Button
              onClick={resetConverter}
              variant="outline"
              className="gap-2 transition-smooth hover:shadow-card"
            >
              <RefreshCw className="w-4 h-4" />
              Convert Another Novel
            </Button>
          </div>
        )}

      </div>
    </div>
  );
};

export default Index;

