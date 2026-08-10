/**
 * Lightweight analytics wrapper.
 * Fires GA4 events via the gtag already loaded in index.html.
 * In dev mode events are printed to the console instead.
 */

declare function gtag(...args: unknown[]): void;

const IS_PROD = import.meta.env.PROD;

export function trackEvent(
  eventName: string,
  params: Record<string, string | number | boolean> = {}
) {
  try {
    if (IS_PROD && typeof gtag === 'function') {
      gtag('event', eventName, params);
    } else {
      console.debug('[analytics]', eventName, params);
    }
  } catch {
    // never let tracking break the app
  }
}

// ── Funnel events ────────────────────────────────────────────────────────────

/** User focused or typed in the URL input */
export const trackInputFocus = () => trackEvent('input_focus');

/** User submitted a URL to fetch chapters */
export const trackUrlSubmitted = (domain: string) =>
  trackEvent('url_submitted', { domain });

/** Chapters were successfully fetched */
export const trackChaptersFetched = (count: number, domain: string) =>
  trackEvent('chapters_fetched', { count, domain });

/** User started EPUB generation */
export const trackEpubStarted = (chapterCount: number) =>
  trackEvent('epub_generation_started', { chapter_count: chapterCount });

/** EPUB was successfully built and offered for download */
export const trackEpubGenerated = (chapterCount: number) =>
  trackEvent('epub_generated', { chapter_count: chapterCount });

/** User clicked the download button */
export const trackEpubDownloaded = () => trackEvent('epub_downloaded');

/** An error occurred — never log full URLs, only a category */
export const trackError = (category: string, message: string) =>
  trackEvent('conversion_error', { category, message: message.slice(0, 100) });

/** User opened the Supported Sites list */
export const trackSitesOpened = () => trackEvent('supported_sites_opened');

/** User navigated to a content page */
export const trackPageView = (page: string) =>
  trackEvent('page_view', { page_path: page });
