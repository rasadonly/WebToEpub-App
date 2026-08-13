import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { trackPageView } from '@/utils/analytics';
import { Button } from '@/components/ui/button';
import { BookOpen, Zap, Shield, Sparkles, CheckCircle2, ArrowRight } from 'lucide-react';

export default function ConverterPage() {
  useEffect(() => {
    document.title = 'Best EPUB Converter — Convert Web Novels Free Online | LinkToEpub';
    trackPageView('/converter');

    // Add JSON-LD Structured Data
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'converter-jsonld';
    script.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      'name': 'LinkToEpub - Online EPUB Converter',
      'applicationCategory': 'UtilitiesApplication',
      'operatingSystem': 'Web Browser (iOS, Android, Windows, Mac, Linux)',
      'offers': { '@type': 'Offer', 'price': '0', 'priceCurrency': 'USD' },
      'description': 'Free online EPUB converter designed for web novels, fanfiction, and online books. Supports 380+ sites including Novelfull, RoyalRoad, ScribbleHub, and WTR-LAB.'
    });
    document.head.appendChild(script);

    return () => {
      document.getElementById('converter-jsonld')?.remove();
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground py-8 px-4">
      <main className="container mx-auto max-w-4xl space-y-12">

        {/* Hero Section */}
        <section className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5" /> Best Online EPUB Converter
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-foreground">
            Free Online <span className="text-primary">EPUB Converter</span> for Web Novels
          </h1>
          <p className="text-muted-foreground text-base sm:text-lg max-w-2xl mx-auto">
            Convert web novels, fanfiction, and online serialized fiction into clean, beautifully formatted <strong>.epub</strong> files for Kindle, Kobo, Apple Books, and Android readers.
          </p>
          <div className="pt-2">
            <Button asChild size="lg" className="font-bold gap-2 shadow-lg">
              <Link to="/">
                Start Converting Free <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>
          </div>
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

        {/* Comparison Table */}
        <section className="bg-card border border-border rounded-xl p-6 space-y-4">
          <h2 className="text-2xl font-bold text-foreground">Feature Comparison</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-muted-foreground">
              <thead className="bg-background text-foreground text-xs uppercase border-b border-border">
                <tr>
                  <th className="py-3 px-4">Feature</th>
                  <th className="py-3 px-4 text-primary font-bold">LinkToEpub</th>
                  <th className="py-3 px-4">Generic Converters</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr>
                  <td className="py-3 px-4 font-medium text-foreground">Web Novel TOC Extraction</td>
                  <td className="py-3 px-4 text-primary font-bold">380+ Sites Supported</td>
                  <td className="py-3 px-4 text-red-400">Single Page Only</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-medium text-foreground">Mobile Phone Compatibility</td>
                  <td className="py-3 px-4 text-primary font-bold">100% Web-Based (iOS &amp; Android)</td>
                  <td className="py-3 px-4 text-amber-400">Desktop Only / Extension Needed</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-medium text-foreground">Background Cloud Server Processing</td>
                  <td className="py-3 px-4 text-primary font-bold">Yes (Close tab safely)</td>
                  <td className="py-3 px-4 text-red-400">No</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-medium text-foreground">Ad &amp; Watermark Cleanup</td>
                  <td className="py-3 px-4 text-primary font-bold">Automatic Clean Formatting</td>
                  <td className="py-3 px-4 text-red-400">Cluttered Output</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="space-y-6">
          <h2 className="text-2xl font-bold text-foreground text-center">Frequently Asked Questions</h2>
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
