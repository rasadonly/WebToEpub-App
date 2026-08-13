import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { trackPageView } from '@/utils/analytics';
import { Globe, Layers, Smartphone, ArrowRight } from 'lucide-react';
import ConversionForm from '@/components/ConversionForm';
import ProgressLog from '@/components/ProgressLog';
import ChapterManager from '@/components/ChapterManager';
import { useEpubConverter } from '@/hooks/useEpubConverter';

export default function WebToEpubPage() {
  const {
    progress,
    logs,
    chapterList,
    setChapterList,
    fetchChapters,
    generateFromChapters,
    stopConversion,
    isConverting,
    isGenerating,
    isFetchingToc,
    serverJob,
    downloadServerJob,
  } = useEpubConverter();

  useEffect(() => {
    document.title = 'Web to EPUB — Convert Any Web Novel to EPUB Online | LinkToEpub';
    trackPageView('/web-to-epub');

    // Add JSON-LD Structured Data
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'web-to-epub-jsonld';
    script.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      'name': 'LinkToEpub - Web to EPUB Converter',
      'applicationCategory': 'UtilitiesApplication',
      'operatingSystem': 'Web Browser (iOS, Android, Windows, Mac, Linux)',
      'offers': { '@type': 'Offer', 'price': '0', 'priceCurrency': 'USD' },
      'description': 'Convert web pages, web serials, fanfiction and articles to EPUB online. Works directly in your browser or background server.'
    });
    document.head.appendChild(script);

    return () => {
      document.getElementById('web-to-epub-jsonld')?.remove();
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground py-8 px-4">
      <main className="container mx-auto max-w-4xl space-y-12">

        {/* Hero Section with Live Form */}
        <section className="space-y-6">
          <div className="text-center space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
              <Globe className="w-3.5 h-3.5" /> Web to EPUB Conversion Tool
            </div>
            <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-foreground">
              Turn Any Web Serial into <span className="text-primary">Web to EPUB</span> Ebooks
            </h1>
            <p className="text-muted-foreground text-base sm:text-lg max-w-2xl mx-auto">
              Extract serialized chapters from your favorite novel websites and compile them into clean EPUB files.
            </p>
          </div>

          {/* Interactive Conversion Form */}
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
        </section>

        {/* Key Workflow */}
        <section className="bg-card border border-border rounded-xl p-6 sm:p-8 space-y-6">
          <h2 className="text-2xl font-bold text-foreground">How Web to EPUB Works</h2>
          <p className="text-muted-foreground leading-relaxed">
            Reading long novels on mobile web browsers leads to lost bookmarks, unwanted intrusive ads, and high battery drain. 
            <strong>Web to EPUB</strong> conversion lets you download complete web novel series onto your Kindle, Kobo, or phone e-reader app for comfortable offline reading.
          </p>

          <div className="grid sm:grid-cols-2 gap-6 pt-2">
            <div className="flex gap-4 items-start">
              <div className="p-2 bg-primary/10 rounded-lg text-primary shrink-0">
                <Layers className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-foreground">Automatic TOC Extraction</h3>
                <p className="text-xs text-muted-foreground">Parses chapter links automatically from index pages, handling pagination and dynamic loading seamlessy.</p>
              </div>
            </div>

            <div className="flex gap-4 items-start">
              <div className="p-2 bg-primary/10 rounded-lg text-primary shrink-0">
                <Smartphone className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-foreground">Mobile Reader Optimized</h3>
                <p className="text-xs text-muted-foreground">Generates responsive HTML text with custom font styles, night mode compatibility, and offline images.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Popular Supported Sites */}
        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-foreground text-center">Popular Web Novel Sites Supported</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs">
            <div className="p-3 bg-card border border-border rounded-lg font-semibold">NovelFull</div>
            <div className="p-3 bg-card border border-border rounded-lg font-semibold">Royal Road</div>
            <div className="p-3 bg-card border border-border rounded-lg font-semibold">Scribble Hub</div>
            <div className="p-3 bg-card border border-border rounded-lg font-semibold">WTR-LAB</div>
            <div className="p-3 bg-card border border-border rounded-lg font-semibold">NovelBin</div>
            <div className="p-3 bg-card border border-border rounded-lg font-semibold">Wattpad</div>
            <div className="p-3 bg-card border border-border rounded-lg font-semibold">AO3 (Fanfiction)</div>
            <div className="p-3 bg-card border border-border rounded-lg font-semibold">NovelFire</div>
          </div>
          <div className="text-center pt-2">
            <Link to="/sites" className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1">
              View complete list of 380+ supported sites <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </section>

        {/* Internal Linking Footer */}
        <section className="border-t border-border/50 pt-8 text-center space-y-4">
          <p className="text-xs text-muted-foreground">Related EPUB resources:</p>
          <div className="flex flex-wrap justify-center gap-4 text-xs font-medium">
            <Link to="/" className="text-primary hover:underline">Link to EPUB Homepage</Link>
            <span>·</span>
            <Link to="/converter" className="text-primary hover:underline">Best EPUB Converter</Link>
            <span>·</span>
            <Link to="/alternatives" className="text-primary hover:underline">WebToEpub Alternative</Link>
            <span>·</span>
            <Link to="/sites" className="text-primary hover:underline">380+ Supported Sites</Link>
            <span>·</span>
            <Link to="/guide" className="text-primary hover:underline">EPUB Conversion Guide</Link>
          </div>
        </section>

      </main>
    </div>
  );
}
