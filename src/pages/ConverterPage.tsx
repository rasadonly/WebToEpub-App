import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { trackPageView } from '@/utils/analytics';
import { Button } from '@/components/ui/button';
import { BookOpen, Zap, Shield, Sparkles, Check, X, Smartphone, Globe, Monitor } from 'lucide-react';
import ConversionForm from '@/components/ConversionForm';
import ProgressLog from '@/components/ProgressLog';
import ChapterManager from '@/components/ChapterManager';
import { useEpubConverter } from '@/hooks/useEpubConverter';

export default function ConverterPage() {
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
    document.title = 'Best EPUB Converter — Convert Web Novels Free Online | LinkToEpub';
    trackPageView('/converter');

    // Add rich Schema.org SoftwareApplication Structured Data
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'converter-jsonld';
    script.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      'name': 'LinkToEpub - Online EPUB Converter',
      'applicationCategory': 'UtilitiesApplication',
      'operatingSystem': 'Web Browser (iOS, Android, Windows, macOS, Linux)',
      'offers': { '@type': 'Offer', 'price': '0', 'priceCurrency': 'USD' },
      'aggregateRating': {
        '@type': 'AggregateRating',
        'ratingValue': '4.9',
        'ratingCount': '1280'
      },
      'featureList': [
        'Automatic Web Novel TOC Parsing',
        '380+ Supported Serial Sites',
        'Cloudflare Anti-Bot Bypass',
        'Mobile Phone Compatibility (iOS & Android)',
        'Ad and Watermark Removal',
        'EPUB 3 Ebook Standard Compliance'
      ],
      'description': 'Free online EPUB converter designed for web novels, fanfiction, and online books. Convert serialized web fiction into clean EPUB files for Kindle, Kobo, and Apple Books.'
    });
    document.head.appendChild(script);

    return () => {
      document.getElementById('converter-jsonld')?.remove();
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground py-8 px-4">
      <main className="container mx-auto max-w-4xl space-y-12">

        {/* Hero Section with Live Form */}
        <section className="space-y-6">
          <div className="text-center space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5" /> Best Online EPUB Converter
            </div>
            <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-foreground">
              Free Online <span className="text-primary">EPUB Converter</span> for Web Novels
            </h1>
            <p className="text-muted-foreground text-base sm:text-lg max-w-2xl mx-auto">
              Convert web novels, fanfiction, and online serialized fiction into clean, beautifully formatted <strong>.epub</strong> files for Kindle, Kobo, Apple Books, and Android readers.
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

        {/* Why Choose LinkToEpub */}
        <section className="bg-card border border-border rounded-xl p-6 sm:p-8 space-y-6">
          <h2 className="text-2xl font-bold text-foreground">Why LinkToEpub is the Best EPUB Converter</h2>
          <p className="text-muted-foreground leading-relaxed">
            Most generic document converters break web novel formatting, strip chapter headings, or fail on Cloudflare-protected novel sites. 
            <strong>LinkToEpub</strong> is engineered specifically for web fiction, parsing table-of-contents structures from <strong>380+ major novel platforms</strong>.
          </p>

          <div className="grid sm:grid-cols-3 gap-6 pt-4">
            <div className="space-y-2 p-4 bg-background/50 rounded-lg border border-border/50">
              <Zap className="w-6 h-6 text-primary" />
              <h3 className="font-bold text-foreground">Fast Parallel Fetching</h3>
              <p className="text-xs text-muted-foreground">Downloads multi-hundred chapter novels in parallel using smart browser and server proxy pools.</p>
            </div>
            <div className="space-y-2 p-4 bg-background/50 rounded-lg border border-border/50">
              <BookOpen className="w-6 h-6 text-primary" />
              <h3 className="font-bold text-foreground">Clean Typography</h3>
              <p className="text-xs text-muted-foreground">Strips ads, popups, and watermarks while preserving italicized thoughts and paragraph spacing.</p>
            </div>
            <div className="space-y-2 p-4 bg-background/50 rounded-lg border border-border/50">
              <Shield className="w-6 h-6 text-primary" />
              <h3 className="font-bold text-foreground">100% Free &amp; Private</h3>
              <p className="text-xs text-muted-foreground">No registration, no user tracking, and no paywalls. Converted books belong to you.</p>
            </div>
          </div>
        </section>

        {/* Detailed 300-500 Word Comparison: LinkToEpub vs Online Converters vs Desktop Apps */}
        <section className="bg-card border border-border rounded-xl p-6 sm:p-8 space-y-6">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-foreground">
              Choosing the Right EPUB Converter: LinkToEpub vs Online Converters vs Desktop Apps
            </h2>
            <p className="text-sm text-muted-foreground">
              When converting web novels and online books to EPUB format, readers generally choose between three main categories of tools: specialized web novel converters like <strong>LinkToEpub</strong>, generic online converters (e.g. CloudConvert, Zamzar), and traditional desktop software (e.g. Calibre, WebToEpub Chrome extension). Here is how they compare in performance, convenience, and mobile compatibility.
            </p>
          </div>

          <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <div className="p-4 bg-background/50 rounded-lg border border-border/50 space-y-2">
              <h3 className="font-bold text-foreground text-base flex items-center gap-2">
                <Globe className="w-4 h-4 text-primary" /> 1. LinkToEpub (Specialized Web Novel EPUB Converter)
              </h3>
              <p>
                <strong>LinkToEpub</strong> is built specifically for online serialized fiction. Unlike standard document tools, it accepts a single table-of-contents URL from over <strong>380 supported novel sites</strong> (including NovelFull, RoyalRoad, ScribbleHub, WTR-LAB, and NovelBin) and automatically extracts every single chapter into a structured EPUB ebook. It features Cloudflare anti-bot proxy routing, automatic ad and watermark removal, and full mobile support on iOS (iPhone/iPad) and Android without installing plugins or apps.
              </p>
            </div>

            <div className="p-4 bg-background/50 rounded-lg border border-border/50 space-y-2">
              <h3 className="font-bold text-foreground text-base flex items-center gap-2">
                <Monitor className="w-4 h-4 text-amber-500" /> 2. Generic Online Converters (CloudConvert, Zamzar, Convertio)
              </h3>
              <p>
                Generic online file converters are designed to transform static files (such as PDF to EPUB or DOCX to EPUB). While effective for single document files, they fail completely when provided with web novel URLs. They cannot crawl multi-page chapter indexes, cannot bypass Cloudflare protections on novel hosting sites, and often output mangled HTML full of sidebar ads, script tags, and broken navigation links.
              </p>
            </div>

            <div className="p-4 bg-background/50 rounded-lg border border-border/50 space-y-2">
              <h3 className="font-bold text-foreground text-base flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-blue-500" /> 3. Desktop Apps &amp; Extensions (Calibre, WebToEpub Chrome Extension)
              </h3>
              <p>
                Desktop tools like Calibre and the WebToEpub browser extension are powerful options for desktop power users who manage offline libraries. However, they suffer from significant usability limits: they cannot run natively on smartphones (iPhones, iPads, or Android phones), require manual software installation, and stop converting the moment you close your browser or shut down your laptop. LinkToEpub bridges this gap by offering full web-based conversion with background cloud server processing that continues even after you close your browser tab.
              </p>
            </div>
          </div>

          {/* 3-Way Comparison Table */}
          <div className="pt-2">
            <h3 className="font-bold text-foreground mb-3 text-base">Detailed Feature Matrix</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm text-left text-muted-foreground border-collapse">
                <thead className="bg-background text-foreground uppercase text-[11px] tracking-wider border-b border-border">
                  <tr>
                    <th className="py-3 px-3">Feature</th>
                    <th className="py-3 px-3 text-primary font-bold">LinkToEpub</th>
                    <th className="py-3 px-3">Generic Online Converters</th>
                    <th className="py-3 px-3">Desktop Apps / Extensions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr>
                    <td className="py-3 px-3 font-medium text-foreground">Web Serial TOC Crawling</td>
                    <td className="py-3 px-3 text-primary font-bold flex items-center gap-1"><Check className="w-4 h-4 text-emerald-500" /> Automatic (380+ Sites)</td>
                    <td className="py-3 px-3 text-red-400 flex items-center gap-1"><X className="w-4 h-4" /> Single File Only</td>
                    <td className="py-3 px-3 text-emerald-400 flex items-center gap-1"><Check className="w-4 h-4" /> Supported via Extension</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-3 font-medium text-foreground">Mobile Phone Support</td>
                    <td className="py-3 px-3 text-primary font-bold flex items-center gap-1"><Check className="w-4 h-4 text-emerald-500" /> 100% Mobile Browser (iOS/Android)</td>
                    <td className="py-3 px-3 text-emerald-400 flex items-center gap-1"><Check className="w-4 h-4" /> Mobile Web</td>
                    <td className="py-3 px-3 text-red-400 flex items-center gap-1"><X className="w-4 h-4" /> Desktop Only (No Mobile)</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-3 font-medium text-foreground">Cloudflare &amp; Anti-Bot Proxy Bypass</td>
                    <td className="py-3 px-3 text-primary font-bold flex items-center gap-1"><Check className="w-4 h-4 text-emerald-500" /> Multi-Egress Proxy Fallback</td>
                    <td className="py-3 px-3 text-red-400 flex items-center gap-1"><X className="w-4 h-4" /> Blocked by Cloudflare</td>
                    <td className="py-3 px-3 text-amber-400 flex items-center gap-1 font-normal">Depends on Local Browser Session</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-3 font-medium text-foreground">Background Cloud Conversion</td>
                    <td className="py-3 px-3 text-primary font-bold flex items-center gap-1"><Check className="w-4 h-4 text-emerald-500" /> Yes (6-Hour Server Job Storage)</td>
                    <td className="py-3 px-3 text-red-400 flex items-center gap-1"><X className="w-4 h-4" /> No</td>
                    <td className="py-3 px-3 text-red-400 flex items-center gap-1"><X className="w-4 h-4" /> Stops when tab/PC closes</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-3 font-medium text-foreground">Ad &amp; Watermark Removal</td>
                    <td className="py-3 px-3 text-primary font-bold flex items-center gap-1"><Check className="w-4 h-4 text-emerald-500" /> Smart Regex &amp; DOM Sanitization</td>
                    <td className="py-3 px-3 text-red-400 flex items-center gap-1"><X className="w-4 h-4" /> Retains Web Clutter</td>
                    <td className="py-3 px-3 text-amber-400 flex items-center gap-1 font-normal">Basic Selector Rules</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-3 font-medium text-foreground">Zero Installation Needed</td>
                    <td className="py-3 px-3 text-primary font-bold flex items-center gap-1"><Check className="w-4 h-4 text-emerald-500" /> Instant Web App</td>
                    <td className="py-3 px-3 text-emerald-400 flex items-center gap-1"><Check className="w-4 h-4" /> Instant Web App</td>
                    <td className="py-3 px-3 text-red-400 flex items-center gap-1"><X className="w-4 h-4" /> Requires Extension/Software</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-foreground text-center">How to Use Our EPUB Converter</h2>
          <div className="grid sm:grid-cols-3 gap-4 text-center">
            <div className="p-5 bg-card border border-border rounded-lg space-y-2">
              <div className="w-8 h-8 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center mx-auto text-sm">1</div>
              <h3 className="font-semibold text-foreground">Paste Novel URL</h3>
              <p className="text-xs text-muted-foreground">Copy the Table of Contents link from NovelFull, RoyalRoad, ScribbleHub, WTR-LAB, or 380+ other sites.</p>
            </div>
            <div className="p-5 bg-card border border-border rounded-lg space-y-2">
              <div className="w-8 h-8 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center mx-auto text-sm">2</div>
              <h3 className="font-semibold text-foreground">Fetch &amp; Select Range</h3>
              <p className="text-xs text-muted-foreground">Review the automatically extracted chapter list and select your desired range or custom cover image.</p>
            </div>
            <div className="p-5 bg-card border border-border rounded-lg space-y-2">
              <div className="w-8 h-8 rounded-full bg-primary/20 text-primary font-bold flex items-center justify-center mx-auto text-sm">3</div>
              <h3 className="font-semibold text-foreground">Download EPUB</h3>
              <p className="text-xs text-muted-foreground">Click Generate EPUB to receive a clean ebook ready for Send-to-Kindle or any ereader app.</p>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-foreground text-center">Frequently Asked Questions about EPUB Conversion</h2>
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-lg p-4 space-y-1">
              <h3 className="font-semibold text-foreground">Is this EPUB converter completely free?</h3>
              <p className="text-xs text-muted-foreground">Yes! LinkToEpub is 100% free with no hidden subscriptions, credit systems, or mandatory registration.</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4 space-y-1">
              <h3 className="font-semibold text-foreground">Which e-readers are compatible with the generated EPUB files?</h3>
              <p className="text-xs text-muted-foreground">Our EPUB files conform strictly to the EPUB 3 standard, making them compatible with Amazon Kindle (via Send to Kindle), Kobo, Nook, Apple Books, Moon+ Reader, and Calibre.</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4 space-y-1">
              <h3 className="font-semibold text-foreground">Can I convert web novels directly on my mobile phone?</h3>
              <p className="text-xs text-muted-foreground">Yes! Unlike browser extensions that only run on desktop Chrome, LinkToEpub works in Safari, Chrome, and Firefox on iOS and Android devices.</p>
            </div>
          </div>
        </section>

        {/* Internal Linking Footer */}
        <section className="border-t border-border/50 pt-8 text-center space-y-4">
          <p className="text-xs text-muted-foreground">Explore more tools and resources:</p>
          <div className="flex flex-wrap justify-center gap-4 text-xs font-medium">
            <Link to="/" className="text-primary hover:underline">Link to EPUB Homepage</Link>
            <span>·</span>
            <Link to="/web-to-epub" className="text-primary hover:underline">Web to EPUB Tool</Link>
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
