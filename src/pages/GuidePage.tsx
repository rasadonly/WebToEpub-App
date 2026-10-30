import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { trackPageView } from '@/utils/analytics';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-xl p-5">
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="space-y-2.5">
      {items.map((step, i) => (
        <li key={i} className="flex gap-3 text-sm text-foreground/90">
          <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
            {i + 1}
          </span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}

export default function GuidePage() {
  useEffect(() => {
    document.title = 'How-to Guide — LinkToEpub';
    trackPageView('/guide');
  }, []);

  return (
    <div className="min-h-screen bg-gradient-hero">
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <nav className="text-sm text-muted-foreground mb-6 flex items-center gap-2">
          <Link to="/" className="hover:text-foreground transition-colors">Home</Link>
          <span>/</span>
          <span>Guide</span>
        </nav>

        <h1 className="text-3xl font-bold mb-2">How to convert a web novel to EPUB</h1>
        <p className="text-muted-foreground mb-8">
          LinkToEpub turns a web novel into a clean EPUB file you can read on any ebook app.
          The whole process is: paste a link, fetch the chapters, generate the file.
          Everything below follows the app exactly as it works today.
        </p>

        <div className="space-y-6">
          <Section title="1. Convert a novel by URL">
            <Steps
              items={[
                <>
                  Open the novel&apos;s <strong>main page</strong> on the source site — the page with the
                  synopsis and the chapter list, not a chapter or reader page. Examples of good URLs:
                  <span className="block mt-1 font-mono text-xs bg-muted px-2 py-1 rounded">allnovelfull.com/the-beginning-after-the-end.html</span>
                  <span className="block mt-1 font-mono text-xs bg-muted px-2 py-1 rounded">novelcool.com/novel/Alchemy-Emperor-of-the-Divine-Dao.html</span>
                </>,
                <>
                  Copy that URL and paste it into the search bar on the home page. The book&apos;s title,
                  author, and cover load automatically — fix anything that looks wrong before you continue.
                </>,
                <>
                  Click <strong>Fetch Chapters</strong>. The chapter list loads with a progress bar.
                  Very long novels can take a few minutes; that is normal.
                </>,
                <>
                  Pick your chapters. By default everything is selected. Under{' '}
                  <strong>Show advanced options</strong> you can set a Start and End Chapter instead —
                  handy for splitting a huge novel into volumes.
                </>,
                <>
                  Click <strong>Generate EPUB</strong>. The file is built on the server.
                </>,
                <>
                  Download the EPUB when it is ready. Generated files stay on the server for 6 hours,
                  so grab yours the same day.
                </>,
              ]}
            />
          </Section>

          <Section title="2. No URL? Search by novel name">
            <p>
              Type the novel&apos;s name into the same search bar instead of a URL. Results come back
              from across the supported sites — pick the right one and it fills in the link for you,
              then continue from Fetch Chapters as above.
            </p>
          </Section>

          <Section title="3. Tune the result (advanced options)">
            <p>
              Under <strong>Show advanced options</strong> you can change the book&apos;s metadata
              (title, author, language), pick a font for the EPUB, choose which site&apos;s layout to
              use, and set custom CSS selectors for the chapter list and chapter text. The selectors
              are the fix when a site fetches but the content comes out empty or wrong.
            </p>
          </Section>

          <Section title="4. Read it">
            <p>
              Open the downloaded EPUB in any ebook app — Kindle, Kobo, Apple Books, Moon+ Reader,
              or anything else that reads EPUB. You can also open it in the built-in{' '}
              <strong>EPUB Reader</strong> from the menu, without leaving the site.
            </p>
          </Section>

          <Section title="5. Skip converting: the Community Library and Forum">
            <p>
              Thousands of novels are already converted. In the <strong>Library</strong> you can
              download ready-made EPUBs straight from the Community collection, plus the Archive.org
              collection — no converting needed. Your own downloads live under My Books.
            </p>
            <p>
              The <strong>Forum</strong> is where the community helps out: report a site that fails,
              request a new site, or request a book you cannot find — another reader can upload the
              EPUB for you and you get thanked by name in the thread.
            </p>
          </Section>

          <Section title="6. When something goes wrong">
            <ul className="space-y-2.5 list-disc pl-5">
              <li>
                <strong className="text-foreground">Fetch fails, or only a few chapters show.</strong>{' '}
                Almost always this means you pasted a chapter URL instead of the novel&apos;s main
                page. Go back to the main page and copy that URL.
              </li>
              <li>
                <strong className="text-foreground">A site fails every time.</strong> It may be
                blocking automated access. Report it in the Forum with the URL so it can be looked at.
              </li>
              <li>
                <strong className="text-foreground">Chapters fetch but the text is empty or wrong.</strong>{' '}
                Try custom selectors under Advanced options for that site&apos;s layout.
              </li>
              <li>
                <strong className="text-foreground">Your site is not in the list of 178 supported sites.</strong>{' '}
                Paste the URL anyway — the AI fallback handles most novel sites automatically.
              </li>
              <li>
                <strong className="text-foreground">Only recent chapters appear.</strong> Some sites
                list only the latest chapters on their main page. If the site has a full chapter list
                page, use that URL instead.
              </li>
            </ul>
          </Section>
        </div>

        <div className="mt-8 bg-card border border-border rounded-xl p-5">
          <h2 className="font-semibold mb-1">Supported sites</h2>
          <p className="text-sm text-muted-foreground">
            <Link to="/sites" className="text-primary hover:underline">Browse the full list of 178 supported sites</Link>.
            If your site is missing, the Forum takes new-site requests.
          </p>
        </div>

        <div className="mt-6 text-center">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Back to converter
          </Link>
        </div>
      </div>
    </div>
  );
}
