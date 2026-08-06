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
body { font-family: ${stack}; line-height: 1.6; margin: 0; padding: 1em; }
h1 { font-size: 1.5em; font-weight: bold; margin: 1em 0; text-align: center; }
h2 { font-size: 1.2em; margin: 1em 0 0.5em 0; }
p { margin: 0 0 1em 0; text-indent: 0; }
blockquote { margin: 1em 2em; font-style: italic; }
hr { border: none; border-top: 1px solid #ccc; margin: 1.5em 0; }`;
}

const VOID_TAGS = "br|hr|img|input|meta|link|source|track|area|base|col|embed|param|wbr";

// HTML5 boolean attributes that may appear without a value (e.g. <div hidden>).
// XHTML requires every attribute to have a value, so we convert them to
// attr="attr" form, or strip them if they're meaningless inside an EPUB.
const STRIP_ATTRS = "itemscope|itemprop|itemtype|itemid|itemref|role|aria-[\\w-]+|data-[\\w-]+|on\\w+";
const BOOL_ATTRS = "hidden|checked|disabled|readonly|required|autofocus|autoplay|controls|loop|muted|defer|async|novalidate|formnovalidate|open|selected|multiple|allowfullscreen|default|reversed|scoped|seamless|typemustmatch|sortable|nomodule|playsinline|disablepictureinpicture|disableremoteplayback|shadowrootmode";

// Make markup XHTML-safe: self-close void tags, drop scripts/styles,
// strip microdata/ARIA/data attrs, and fix boolean attrs.
function toXhtml(html = "") {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    // Strip schema.org microdata, ARIA, data-*, & event attributes (valueless or with value)
    .replace(new RegExp(`\\s+(?:${STRIP_ATTRS})(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]*))?`, "gi"), "")
    // Fix boolean attributes without values: <tag hidden> → <tag hidden="hidden">
    .replace(new RegExp(`(<[a-zA-Z][^>]*?)\\s+(${BOOL_ATTRS})(?=[\\s/>])(?!\\s*=)`, "gi"), (_m, before, attr) => {
      return `${before} ${attr.toLowerCase()}="${attr.toLowerCase()}"`;
    })
    .replace(new RegExp(`<(${VOID_TAGS})((?:\\s[^<>]*?)?)\\s*/?>`, "gi"), (_m, tag, attrs) => {
      const cleaned = String(attrs).replace(/\s+(on\w+|data-[\w-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, "");
      return `<${tag}${cleaned} />`;
    })
    .replace(/<\/(?:br|hr|img)\s*>/gi, "")
    .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;");
}

function chapterXhtml(chapter) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
<head>
  <title>${escapeXml(chapter.title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <h1>${escapeXml(chapter.title)}</h1>
  ${toXhtml(chapter.content)}
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
