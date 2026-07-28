import ConversionForm from '@/components/ConversionForm';
import ProgressLog from '@/components/ProgressLog';
import ChapterManager from '@/components/ChapterManager';
import { useEpubConverter } from '@/hooks/useEpubConverter';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { useEffect, useRef } from 'react';

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

  return (
    <div
      ref={pageRef}
      className="min-h-screen bg-gradient-hero"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-8 space-y-6 sm:space-y-8 max-w-full">

        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Convert Any Link to EPUB Online
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base max-w-2xl mx-auto">
            Free online web novel to EPUB converter.
          </p>
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
          <ProgressLog progress={progress} logs={logs} onStop={stopConversion} />
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

        {/* SEO / Info Section */}
        <div className="max-w-4xl mx-auto mt-16 p-6 sm:p-8 bg-card rounded-xl border shadow-sm space-y-8 text-card-foreground">
          <section className="space-y-3">
            <h2 className="text-2xl font-semibold tracking-tight">How to turn a web page link into an EPUB</h2>
            <p className="text-muted-foreground leading-relaxed">
              LinkToEpub is a powerful tool designed to convert web novels, online books, and web page links into clean, device-ready EPUB files. It automatically extracts the table of contents and chapter content, skipping ads and clutter.
            </p>
          </section>

          <section className="space-y-4">
            <h3 className="text-xl font-medium tracking-tight">Step-by-step instructions</h3>
            <ol className="list-decimal list-inside space-y-2 text-muted-foreground ml-2">
              <li><strong>Step 1: Paste URL:</strong> Copy the link to the table of contents of the web novel or web page you want to convert and paste it into the search bar above.</li>
              <li><strong>Step 2: Fetch Chapters:</strong> Click the arrow button to fetch the chapters. You can customize the chapters you want to download or edit their titles.</li>
              <li><strong>Step 3: Click Convert:</strong> Click the "Generate EPUB" button to start the conversion process. Once complete, your EPUB will automatically download!</li>
            </ol>
          </section>

          <section className="space-y-4">
            <h3 className="text-xl font-medium tracking-tight">Frequently Asked Questions</h3>
            <div className="space-y-4">
              <div>
                <h4 className="font-medium">Which websites are supported?</h4>
                <p className="text-sm text-muted-foreground mt-1">We support over 380+ sites including Novelfull, NovelBin, NovelFire, WTR-LAB, Royal Road, and many more.</p>
              </div>
              <div>
                <h4 className="font-medium">Is this service free?</h4>
                <p className="text-sm text-muted-foreground mt-1">Yes! LinkToEpub is completely free to use.</p>
              </div>
              <div>
                <h4 className="font-medium">Can I read the EPUB on my Kindle or Apple Books?</h4>
                <p className="text-sm text-muted-foreground mt-1">Absolutely. The generated EPUB files are standard-compliant and work perfectly on Apple Books, Google Play Books, and can be sent to Kindle.</p>
              </div>
            </div>
          </section>
        </div>

      </div>
    </div>
  );
};

export default Index;

