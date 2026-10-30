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
      className="min-h-screen bg-background relative overflow-x-hidden"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {/* Background ambient lighting accents */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-96 bg-gradient-to-b from-primary/10 via-primary/5 to-transparent blur-3xl pointer-events-none -z-10" />
      <div className="absolute top-1/4 right-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl pointer-events-none -z-10" />

      <main className="container mx-auto px-4 sm:px-6 md:px-8 py-6 sm:py-12 space-y-8 sm:space-y-12 max-w-6xl">

        {/* Main Content */}
        <div className="space-y-8">
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
          <div className="flex justify-center pt-4">
            <Button
              onClick={resetConverter}
              variant="outline"
              className="gap-2 px-6 py-5 text-base transition-smooth hover:shadow-card font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              Convert Another Novel
            </Button>
          </div>
        )}

        {/* ── FAQ Section (matches JSON-LD in index.html) ── */}
        <section className="pt-8 sm:pt-16 pb-4">
          <h2 className="font-display text-xl sm:text-2xl font-bold text-center mb-6">
            Frequently Asked Questions
          </h2>
          <div className="max-w-2xl mx-auto space-y-3">
            {[
              {
                q: 'How do I convert a web novel to EPUB?',
                a: 'Paste the novel\u2019s table of contents URL into LinkToEpub, click Fetch, optionally pick a chapter range, then click Generate EPUB to download the file.',
              },
              {
                q: 'Which web novel sites are supported?',
                a: 'LinkToEpub supports 178 sites including NovelFull, NovelFire, Scribble Hub, FreeWebNovel, WebNovel and many more.',
              },
              {
                q: 'Is LinkToEpub free?',
                a: 'Yes. LinkToEpub is completely free to use, runs in your browser, and does not require an account or registration.',
              },
              {
                q: 'Will the EPUB work on my Kindle or e-reader?',
                a: 'Yes. The generated EPUB uses standard EPUB 3 formatting and works on Kindle (via Send to Kindle), Kobo, Apple Books, Google Play Books and most e-readers.',
              },
              {
                q: 'How do I convert a NovelFull novel to EPUB?',
                a: 'Go to the novel\u2019s main page on NovelFull (novelfull.com), copy the URL, paste it into LinkToEpub, click Fetch Chapters, then Generate EPUB.',
              },
              {
                q: 'Can I select specific chapters to download?',
                a: 'Yes. After fetching the chapter list, use the Chapter Range selector to choose a start and end chapter. This is useful for downloading specific arcs of long novels.',
              },
              {
                q: 'Does LinkToEpub store my novels?',
                a: 'No. Generated EPUB files are temporarily stored on our server for download and automatically deleted within 6 hours. Novel content is never stored in a database.',
              },
              {
                q: 'What if my site isn\u2019t supported?',
                a: 'LinkToEpub includes an AI fallback that automatically detects chapter structure on unsupported sites. Just paste the URL and try \u2014 it works on most novel sites even without an explicit parser.',
              },
            ].map(({ q, a }) => (
              <details
                key={q}
                className="group rounded-xl border border-border bg-card overflow-hidden transition-all hover:border-primary/30"
              >
                <summary className="flex items-center justify-between cursor-pointer px-4 sm:px-5 py-3.5 text-sm font-semibold text-foreground select-none list-none [&::-webkit-details-marker]:hidden">
                  {q}
                  <span className="ml-3 text-muted-foreground transition-transform group-open:rotate-45 text-lg leading-none shrink-0">+</span>
                </summary>
                <div className="px-4 sm:px-5 pb-4 text-sm text-muted-foreground leading-relaxed border-t border-border pt-3">
                  {a}
                </div>
              </details>
            ))}
          </div>
          <p className="text-center text-xs text-muted-foreground mt-6">
            Have another question?{' '}
            <Link to="/guide" className="text-primary hover:underline">
              Read the full guide
            </Link>
          </p>
        </section>

      </main>
    </div>
  );
};

export default Index;
