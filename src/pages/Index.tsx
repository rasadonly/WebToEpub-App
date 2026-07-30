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

        {/* Header intentionally minimal — form provides the hero */}


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

      </div>
    </div>
  );
};

export default Index;

