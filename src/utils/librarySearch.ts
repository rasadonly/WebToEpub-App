/** Preserve every writing system while ignoring punctuation and filename suffixes. */
export function normalizeBookSearch(value: string): string {
  return (value || '').normalize('NFKC').toLowerCase()
    .replace(/\.(epub|txt)$/i, '')
    .replace(/[’'`]/g, '')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim();
}

export function matchesLibrarySearch(title: string, author: string, query: string): boolean {
  if (!query.trim()) return true;
  const compact = (value: string) => normalizeBookSearch(value).replace(/\s/g, '');
  const wanted = compact(query);
  return Boolean(wanted) && [title, author].some(value => compact(value).includes(wanted));
}

export function libraryMatchScore(bookTitle: string, wanted: string): number {
  const title = normalizeBookSearch(bookTitle);
  const query = normalizeBookSearch(wanted);
  if (!title || !query) return 0;
  if (title === query) return 1;
  // A stray one-letter suffix must never match a word anywhere in the query.
  if (title.length < 3 || query.length < 3) return 0;
  if (title.includes(query)) return 0.85;
  if (query.includes(title) && title.length / query.length >= 0.75) return 0.85;
  const titleWords = new Set(title.split(' ').filter(word => word.length > 1));
  const queryWords = query.split(' ').filter(word => word.length > 1);
  if (queryWords.length < 2) return 0;
  const hits = queryWords.filter(word => titleWords.has(word)).length;
  return hits / Math.max(queryWords.length, titleWords.size);
}