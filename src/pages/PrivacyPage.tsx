import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { trackPageView } from '@/utils/analytics';

export default function PrivacyPage() {
  useEffect(() => {
    document.title = 'Privacy — LinkToEpub';
    trackPageView('/privacy');
  }, []);

  return (
    <div className="min-h-screen bg-gradient-hero">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <nav className="text-sm text-muted-foreground mb-6 flex items-center gap-2">
          <Link to="/" className="hover:text-foreground transition-colors">Home</Link>
          <span>/</span>
          <span>Privacy</span>
        </nav>

        <h1 className="text-3xl font-bold mb-2">Privacy</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated August 2026</p>

        <div className="space-y-8 text-sm leading-relaxed">

          <section>
            <h2 className="font-semibold text-base mb-2">What actually happens when you use LinkToEpub</h2>
            <ul className="space-y-2 text-muted-foreground">
              <li>
                <strong className="text-foreground">The URL you paste</strong> — sent to our server to fetch chapters.
                Processed in memory, never saved to a database.
              </li>
              <li>
                <strong className="text-foreground">The EPUB file</strong> — written to disk temporarily so you can download it.
                Deleted automatically after 6 hours.
              </li>
              <li>
                <strong className="text-foreground">Novel content</strong> — used only to build the EPUB.
                We don't read it, store it, or index it.
              </li>
              <li>
                <strong className="text-foreground">No account required</strong> — we don't collect your name, email, or any personal info.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">Analytics</h2>
            <p className="text-muted-foreground">
              We use Google Analytics 4 to see how many people visit and how far they get through the conversion flow.
              We track events like "EPUB generated" — not what novel or URL you used.
              Google may set cookies and anonymize your IP. You can opt out with the{' '}
              <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                GA opt-out add-on
              </a>.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">Third-party services used</h2>
            <ul className="space-y-1 text-muted-foreground">
              <li><strong className="text-foreground">Google Analytics</strong> — usage stats</li>
              <li><strong className="text-foreground">Supabase</strong> — hosts the AI parser function (no content stored)</li>
              <li><strong className="text-foreground">NVIDIA / Pollinations AI</strong> — used as a fallback to figure out a site's HTML structure; only the page structure, not your data, is sent</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">Copyright</h2>
            <p className="text-muted-foreground">
              LinkToEpub fetches content that's publicly accessible. It doesn't bypass paywalls or DRM.
              It's your responsibility to make sure you're allowed to save what you're downloading.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base mb-2">Questions</h2>
            <p className="text-muted-foreground">
              Open an issue on{' '}
              <a href="https://github.com/chatuser129-oss/epub-novel-forge-2c8fbc2b" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                GitHub
              </a>.
            </p>
          </section>
        </div>

        <div className="mt-10">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Back to converter
          </Link>
        </div>
      </div>
    </div>
  );
}
