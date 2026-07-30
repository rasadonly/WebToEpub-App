// Server-side EPUB packer — mirrors src/utils/epubGenerator.ts output byte-for-byte
// in structure (same CSS, same OPF/NCX), but returns a Buffer instead of downloading.
import JSZip from "jszip";

function escapeXml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function sanitizeFilename(name = "book") {
  return name.replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, "_").toLowerCase() || "book";
}

const FONT_STACKS = {
  Georgia: '"Georgia", "Times New Roman", serif',
  Merriweather: '"Merriweather", "Georgia", serif',
  "Crimson Text": '"Crimson Text", "Times New Roman", serif',
  "Libre Baskerville": '"Libre Baskerville", "Georgia", serif',
  "Source Serif Pro": '"Source Serif Pro", "Georgia", serif',
};

function css(fontFamily = "Georgia") {
  const stack = FONT_STACKS[fontFamily] || FONT_STACKS.Georgia;
  return `@charset "UTF-8";
body { font-family: ${stack}; line-height: 1.7; margin: 0; padding: 2em; color: #2c3e50; background-color: #fdfdfd; }
@media screen and (max-width: 600px) { body { padding: 1em; line-height: 1.6; } }
h1 { font-size: 2em; font-weight: 700; margin: 1.5em 0 1em 0; text-align: center; color: #34495e; border-bottom: 3px solid #3498db; padding-bottom: 0.5em; line-height: 1.3; }
h2 { font-size: 1.5em; font-weight: 600; margin: 2em 0 1em 0; color: #34495e; }
h3 { font-size: 1.2em; font-weight: 600; margin: 1.5em 0 0.5em 0; color: #34495e; }
p { margin: 0 0 1.2em 0; text-align: justify; text-indent: 1.5em; orphans: 2; widows: 2; }
h1 + p, h2 + p, h3 + p { text-indent: 0; margin-top: 0.5em; }
.chapter-content { max-width: 45em; margin: 0 auto; overflow-wrap: break-word; }
blockquote { margin: 1.5em 2em; padding: 1em; border-left: 4px solid #3498db; background-color: #f8f9fa; font-style: italic; }
ul, ol { margin: 1em 0; padding-left: 2em; }
li { margin: 0.5em 0; }
a { color: #3498db; text-decoration: underline; }
hr { border: none; border-top: 1px solid #bdc3c7; margin: 2em 0; }
@media (prefers-color-scheme: dark) {
  body { background-color: #1a1a1a; color: #e8e8e8; }
  h1, h2, h3 { color: #f0f0f0; }
  h1 { border-bottom-color: #4a90e2; }
  blockquote { background-color: #2a2a2a; border-left-color: #4a90e2; }
  hr { border-top-color: #404040; }
}`;
}

function chapterXhtml(chapter) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
<head>
  <meta http-equiv="Content-Type" content="application/xhtml+xml; charset=utf-8"/>
  <title>${escapeXml(chapter.title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
</head>
<body>
  <div class="chapter-content">
    <h1>${escapeXml(chapter.title)}</h1>
    ${chapter.content}
  </div>
</body>
</html>`;
}

export async function buildEpub(chapters, metadata, options = {}) {
  const zip = new JSZip();
  const id = uuid();

  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.folder("META-INF").file(
    "container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
  );

  const oebps = zip.folder("OEBPS");
  const ids = chapters.map((_, i) => `chapter_${String(i + 1).padStart(3, "0")}`);

  oebps.file(
    "content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookID">${id}</dc:identifier>
    <dc:title>${escapeXml(metadata.title)}</dc:title>
    <dc:creator>${escapeXml(metadata.author || "Unknown")}</dc:creator>
    <dc:language>${escapeXml(metadata.language || "en")}</dc:language>
    <dc:date>${new Date().toISOString().split("T")[0]}</dc:date>
    ${metadata.description ? `<dc:description>${escapeXml(metadata.description)}</dc:description>` : ""}
    <meta property="dcterms:modified">${new Date().toISOString()}</meta>
    <meta name="generator" content="Link to EPUB"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
${ids.map((cid) => `    <item id="${cid}" href="${cid}.xhtml" media-type="application/xhtml+xml"/>`).join("\n")}
  </manifest>
  <spine toc="ncx">
${ids.map((cid) => `    <itemref idref="${cid}"/>`).join("\n")}
  </spine>
</package>`
  );

  oebps.file(
    "toc.ncx",
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${id}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(metadata.title)}</text></docTitle>
  <navMap>
${chapters
  .map(
    (c, i) => `    <navPoint id="navPoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${escapeXml(c.title)}</text></navLabel>
      <content src="${ids[i]}.xhtml"/>
    </navPoint>`
  )
  .join("\n")}
  </navMap>
</ncx>`
  );

  oebps.file("style.css", css(options.fontFamily));
  chapters.forEach((c, i) => oebps.file(`${ids[i]}.xhtml`, chapterXhtml(c)));

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
