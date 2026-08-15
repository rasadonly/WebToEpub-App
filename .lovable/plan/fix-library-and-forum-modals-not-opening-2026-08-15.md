# Fix: Library and Forum modals not opening

## What's wrong

Clicking Library or Forum crashes the app instead of opening the modal (React error #306 in the console).

All six modal components are loaded lazily in `src/components/GlobalModals.tsx`, which expects each file to have a default export. But `LibraryModal`, `ForumModal`, `EpubReaderModal`, `LiveReaderModal`, `SupportedSites`, and `AdminPanel` each only have a named export, so the lazy loader receives `undefined` and React throws.

## The fix

In `src/components/GlobalModals.tsx`, change each lazy import to pick up the named export, e.g.:

```ts
const LibraryModal = lazy(() =>
  import('@/components/LibraryModal').then(m => ({ default: m.LibraryModal }))
);
```

Apply the same for the other five modals. No component code or UI changes needed.

## Verify

Open the app, click Library and Forum from both the desktop nav and the mobile quick-nav, and confirm each modal opens with no console errors. Also spot-check Supported Sites, Live Reader, EPUB Reader, and Admin from the three-dot menu, since they share the same defect.
