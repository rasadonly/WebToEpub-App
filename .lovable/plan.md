# Fix library stuck at "Showing 80 of 2990 books"

## What is happening

All 2990 community books are loaded correctly, but the grid only renders the first 80 and relies on a manual **Load more** button at the very bottom of the list. Nothing loads automatically as you scroll, so the list feels stuck at 80. The button is easy to miss and, on mobile, sits below a long grid inside a nested scroll area.

## What will change

1. **Auto-load on scroll (infinite scroll)** – a small invisible sentinel is placed after the grid inside the scrollable body. When it comes into view, the next 80 books are appended automatically, repeating until all books are shown. No clicking required.
2. **Keep "Load more" as a fallback** – the button stays for browsers where the observer doesn't fire, and it also shows a "Show all" option so you can render the entire list at once.
3. **Reset paging on search / tab change** – typing a search query or switching tabs resets the visible window to the first 80 so results always start from the top.
4. **Make sure the body actually scrolls** – add `min-h-0` to the scroll container so the flex layout can't clip it on small screens (the same class of mobile-scroll bug seen earlier).
5. **Counter reflects progress** – "Showing X of Y books" updates live as more rows are appended.

## Technical details

- File: `src/components/LibraryModal.tsx`
  - Add a `sentinelRef` (`div` after the grid) and a `scrollRef` on the body container.
  - `useEffect` creating an `IntersectionObserver` with `root: scrollRef.current`, `rootMargin: '400px'`; on intersect call `setVisibleCount(c => Math.min(c + LOAD_MORE_COUNT, filtered.length))`. Re-attach when `filtered.length`, `visibleCount`, `loading`, or `tab` change; disconnect on cleanup.
  - `useEffect` on `[query, tab]` → `setVisibleCount(INITIAL_VISIBLE_BOOKS)`.
  - Add `min-h-0` to the `flex-1 overflow-y-auto p-4` body div.
  - Keep the existing **Load more** button and add a **Show all** button that sets `visibleCount = filtered.length`.
- No backend or data-fetching changes; `libraryGetCommunity()` already returns the full paginated list.
- Verification: open the Library in the preview via Playwright, scroll the body to the bottom repeatedly, and confirm the "Showing X of Y" counter climbs past 80 without clicking anything.
