import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { trackPageView } from '@/utils/analytics';

export default function PrivacyPage() {
  useEffect(() => {
    document.title = 'Privacy Policy — LinkToEpub';
    trackPageView('/privacy');
  }, []);

  return (
    <div className="min-h-screen bg-gradient-hero">
      <div className="container mx-auto px-4 py-10 max-w-2xl">
        {/* Breadcrumb */}
        <nav className="text-sm text-muted-foreground mb-6 flex items-center gap-2">
          <Link to="/" className="hover:text-foreground transition-colors">Home</Link>
          <span>/</span>
          <span>Privacy</span>
        </nav>

        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-10">Last updated: August 2026</p>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8 text-sm leading-relaxed">

          <section>
            <h2 className="text-lg font-semibold mb-2">What we collect</h2>
            <p className="text-muted-foreground">
              LinkToEpub is designed to be privacy-friendly. Here is exactly what happens when you use the service:
            </p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground mt-2">
              <li><strong className="text-foreground">The URL you paste</strong> — sent to our backend server to fetch chapters. It is processed in memory and never stored in a database.</li>
              <li><strong className="text-foreground">Generated EPUB files</strong> — temporarily written to disk on our server to allow download. They are automatically deleted within 6 hours.</li>
              <li><strong className="text-foreground">Novel content</strong> — chapter text is fetched from the source site and used only to build the EPUB. It is never stored, indexed, or read by us.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Analytics</h2>
            <p className="text-muted-foreground">
              We use <strong className="text-foreground">Google Analytics 4</strong> to understand aggregate usage patterns — how many people visit, which pages they land on, and which steps of the conversion flow complete successfully. 
              Google Analytics uses cookies and may collect your IP address (which Google anonymizes).
              We do not send novel URLs or content to Google Analytics — only anonymized funnel events (e.g. "EPUB generated").
            </p>
            <p className="text-muted-foreground mt-2">
              You can opt out by installing the <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Google Analytics Opt-out Browser Add-on</a>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Cookies</h2>
            <p className="text-muted-foreground">
              We do not set any first-party cookies. Google Analytics sets third-party cookies for session and visitor tracking. 
              No account, login, or personal data is required to use LinkToEpub.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Third-party services</h2>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li><strong className="text-foreground">Google Analytics</strong> — usage analytics (<a href="https://policies.google.com/privacy" className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">Google Privacy Policy</a>)</li>
              <li><strong className="text-foreground">Supabase</strong> — backend functions for AI-assisted parsing (no content is stored)</li>
              <li><strong className="text-foreground">NVIDIA / Pollinations AI</strong> — used as a fallback to detect page structure on unsupported sites. Only anonymized HTML structure (no user data) is sent.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Copyright & usage</h2>
            <p className="text-muted-foreground">
              LinkToEpub is a tool for converting web content you are authorized to access. 
              It does not bypass paywalls, DRM, or access-restricted content. 
              Users are responsible for ensuring their use of downloaded content complies with the source site's terms of service and applicable copyright law.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Contact</h2>
            <p className="text-muted-foreground">
              If you have any questions about this policy, please open an issue on our{' '}
              <a href="https://github.com/chatuser129-oss/epub-novel-forge-2c8fbc2b" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                GitHub repository
              </a>.
            </p>
          </section>
        </div>

        <div className="mt-10 text-center">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Back to converter
          </Link>
        </div>
      </div>
    </div>
  );
}
