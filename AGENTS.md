# Project rules

- Serve completed EPUBs through `server/src/download.js` using Express file downloads; this provides standards-compliant Unicode filenames and handles missing files without crashing the server.
- Conversion jobs spool chapter XHTML to temporary files and stream EPUB output; shared fetch, packing, and upload pools prevent concurrent books from multiplying heap usage.