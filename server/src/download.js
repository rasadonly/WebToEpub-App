// Express encodes Unicode attachment names using RFC 5987, with a safe fallback.
export function sendEpub(res, file, filename = "book.epub") {
  const cleaned = String(filename)
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_");
  const name = cleaned.toLowerCase().endsWith(".epub") ? cleaned : `${cleaned || "book"}.epub`;
  res.download(file, name, {
    headers: { "Content-Type": "application/epub+zip" },
  }, (err) => {
    if (!err || res.headersSent) return;
    res.status(err.statusCode === 404 || err.code === "ENOENT" ? 404 : 500)
      .json({ error: "EPUB download unavailable. Please convert the book again." });
  });
}