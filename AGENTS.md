# Project rules

- Serve completed EPUBs through `server/src/download.js` using Express file downloads; this provides standards-compliant Unicode filenames and handles missing files without crashing the server.
- Conversion jobs spool chapter XHTML to temporary files and stream EPUB output; shared fetch, packing, and upload pools prevent concurrent books from multiplying heap usage.
- NovGo metadata analysis and chapter loading share a short-lived, bounded server TOC result in the frontend; this avoids loading the browser parser and downloading the TOC twice while retaining its fallback.
- Library search uses browser-managed draft inputs synchronized through refs, separate from the submitted filter; typing must not redraw book lists. Keep download callbacks stable and expand book rows on demand, not with background timers.