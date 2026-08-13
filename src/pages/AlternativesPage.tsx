import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { trackPageView } from '@/utils/analytics';
import { Button } from '@/components/ui/button';
import { Check, X, Shield, Smartphone, Cloud, ArrowRight, Sparkles } from 'lucide-react';

export default function AlternativesPage() {
  useEffect(() => {
    document.title = 'WebToEpub Alternative — Free Online Browser & Mobile Converter | LinkToEpub';
    trackPageView('/alternatives');

    // Add JSON-LD Structured Data
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'alternatives-jsonld';
    script.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      'name': 'LinkToEpub - WebToEpub Alternative',
      'applicationCategory': 'UtilitiesApplication',
      'operatingSystem': 'Web Browser (iOS, Android, Windows, Mac, Linux)',
      'offers': { '@type': 'Offer', 'price': '0', 'priceCurrency': 'USD' },
      'description': 'The top online WebToEpub alternative. Works on mobile phones (iPhone, Android) and desktop without installing Chrome extensions.'
    });
    document.head.appendChild(script);

    return () => {
      document.getElementById('alternatives-jsonld')?.remove();
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground py-8 px-4">
      <main className="container mx-auto max-w-4xl space-y-12">

        {/* Hero Section */}
        <section className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5" /> WebToEpub Extension Alternative
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-foreground">
            The #1 <span className="text-primary">WebToEpub Alternative</span> That Works on Mobile
          </h1>
          <p className="text-muted-foreground text-base sm:text-lg max-w-2xl mx-auto">
            Love WebToEpub but need a web app that works on iPhone, Android, iPad, and desktop without installing browser extensions? Meet <strong>LinkToEpub</strong>.
          </p>
          <div className="pt-2">
            <Button asChild size="lg" className="font-bold gap-2 shadow-lg">
              <Link to="/">
                Try WebToEpub Online Free <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>
          </div>
        </section>

        {/* Why Switch Section */}
        <section className="bg-card border border-border rounded-xl p-6 sm:p-8 space-y-6">
          <h2 className="text-2xl font-bold text-foreground">Why Readers Are Switching to LinkToEpub</h2>
          <p className="text-muted-foreground leading-relaxed">
            The classic <em>WebToEpub Chrome extension</em> is legendary, but browser extensions don't run on iPhones, iPads, or standard mobile Chrome/Safari. 
            <strong>LinkToEpub</strong> ports the full 380+ site parser engine into a modern web application accessible from any device.
          </p>

          <div className="grid sm:grid-cols-3 gap-4 pt-2">
            <div className="p-4 bg-background/50 border border-border/50 rounded-lg space-y-2">
              <Smartphone className="w-6 h-6 text-primary" />
              <h3 className="font-bold text-foreground">iOS &amp; Android Friendly</h3>
              <p className="text-xs text-muted-foreground">Convert web novels directly on your mobile browser and send them to Kindle or Apple Books in seconds.</p>
            </div>
            <div className="p-4 bg-background/50 border border-border/50 rounded-lg space-y-2">
              <Cloud className="w-6 h-6 text-primary" />
              <h3 className="font-bold text-foreground">Background Cloud Dyno</h3>
              <p className="text-xs text-muted-foreground">Generating a 3,000-chapter epic? Start the job, close your tab, and come back hours later to download.</p>
            </div>
            <div className="p-4 bg-background/50 border border-border/50 rounded-lg space-y-2">
              <Shield className="w-6 h-6 text-primary" />
              <h3 className="font-bold text-foreground">Zero Extension Install</h3>
              <p className="text-xs text-muted-foreground">No suspicious extension permissions or browser updates required. Works instant in any browser.</p>
            </div>
          </div>
        </section>

        {/* Detailed Comparison */}
        <section className="bg-card border border-border rounded-xl p-6 space-y-4">
          <h2 className="text-2xl font-bold text-foreground">WebToEpub Extension vs. LinkToEpub Web App</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-muted-foreground">
              <thead className="bg-background text-foreground text-xs uppercase border-b border-border">
                <tr>
                  <th className="py-3 px-4">Capability</th>
                  <th className="py-3 px-4 text-primary font-bold">LinkToEpub (Web App)</th>
                  <th className="py-3 px-4">WebToEpub (Chrome Extension)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr>
                  <td className="py-3 px-4 font-medium text-foreground">Mobile Phone Support (iOS/Android)</td>
                  <td className="py-3 px-4 text-primary font-bold flex items-center gap-1"><Check className="w-4 h-4 text-green-500" /> Yes (100% Mobile Ready)</td>
                  <td className="py-3 px-4 text-red-400 flex items-center gap-1"><X className="w-4 h-4" /> No (Desktop Only)</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-medium text-foreground">Installation Required</td>
                  <td className="py-3 px-4 text-primary font-bold flex items-center gap-1"><Check className="w-4 h-4 text-green-500" /> None (Instant Web Link)</td>
                  <td className="py-3 px-4 text-amber-400 flex items-center gap-1">Requires Chrome/Firefox Ext</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-medium text-foreground">Close Tab While Converting</td>
                  <td className="py-3 px-4 text-primary font-bold flex items-center gap-1"><Check className="w-4 h-4 text-green-500" /> Yes (Server Processing)</td>
                  <td className="py-3 px-4 text-red-400 flex items-center gap-1"><X className="w-4 h-4" /> No (Must Keep Browser Open)</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-medium text-foreground">Community Library &amp; Saved Books</td>
                  <td className="py-3 px-4 text-primary font-bold flex items-center gap-1"><Check className="w-4 h-4 text-green-500" /> Built-in 7-Day Storage</td>
                  <td className="py-3 px-4 text-red-400 flex items-center gap-1"><X className="w-4 h-4" /> Local File Save Only</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 font-medium text-foreground">Supported Site Parsers</td>
                  <td className="py-3 px-4 text-primary font-bold">380+ Pre-Configured Sites</td>
                  <td className="py-3 px-4">380+ Sites</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Internal Linking Footer */}
        <section className="border-t border-border/50 pt-8 text-center space-y-4">
          <p className="text-xs text-muted-foreground">Related EPUB conversion tools:</p>
          <div className="flex flex-wrap justify-center gap-4 text-xs font-medium">
            <Link to="/" className="text-primary hover:underline">Link to EPUB Homepage</Link>
            <span>·</span>
            <Link to="/converter" className="text-primary hover:underline">Best EPUB Converter</Link>
            <span>·</span>
            <Link to="/web-to-epub" className="text-primary hover:underline">Web to EPUB Tool</Link>
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
