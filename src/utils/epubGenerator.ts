import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { ChapterData, EpubMetadata } from '@/types';

export async function generateEpub(
  chapters: ChapterData[],
  metadata: EpubMetadata,
  options?: {
    fontFamily?: string;
    includeIndex?: boolean;
    chapterRange?: { start: number; end: number; useAll: boolean };
  }
): Promise<void> {
  const zip = new JSZip();

  // Add mimetype (uncompressed)
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  // Add META-INF
  const metaInf = zip.folder('META-INF')!;
  metaInf.file('container.xml', generateContainerXml());

  // Add OEBPS folder
  const oebps = zip.folder('OEBPS')!;

  // Add content.opf
  oebps.file('content.opf', generateContentOpf(chapters, metadata));

  // Add toc.ncx
  oebps.file('toc.ncx', generateTocNcx(chapters, metadata));

  // Add CSS
  oebps.file('style.css', generateCss(options?.fontFamily));

  // Add chapters
  chapters.forEach((chapter, index) => {
    const filename = `chapter_${String(index + 1).padStart(3, '0')}.xhtml`;
    oebps.file(filename, generateChapterXhtml(chapter, options?.fontFamily));
  });

  // Generate and download
  const blob = await zip.generateAsync({ type: 'blob' });
  const filename = `${sanitizeFilename(metadata.title)}.epub`;
  saveAs(blob, filename);
}

function generateContainerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
}

function generateContentOpf(chapters: ChapterData[], metadata: EpubMetadata): string {
  const chapterManifest = chapters.map((_, index) => {
    const id = `chapter_${String(index + 1).padStart(3, '0')}`;
    return `    <item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`;
  }).join('\n');

  const chapterSpine = chapters.map((_, index) => {
    const id = `chapter_${String(index + 1).padStart(3, '0')}`;
    return `    <itemref idref="${id}"/>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookID">${generateUUID()}</dc:identifier>
    <dc:title>${escapeXml(metadata.title)}</dc:title>
    <dc:creator>${escapeXml(metadata.author)}</dc:creator>
    <dc:language>${metadata.language}</dc:language>
    <dc:date>${new Date().toISOString().split('T')[0]}</dc:date>
    ${metadata.description ? `<dc:description>${escapeXml(metadata.description)}</dc:description>` : ''}
    <meta property="dcterms:modified">${new Date().toISOString()}</meta>
    <meta name="generator" content="Link to EPUB"/>
    <meta property="media:duration" content="PT0H0M0S"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
${chapterManifest}
  </manifest>
  <spine toc="ncx">
${chapterSpine}
  </spine>
</package>`;
}

function generateTocNcx(chapters: ChapterData[], metadata: EpubMetadata): string {
  const navPoints = chapters.map((chapter, index) => {
    const playOrder = index + 1;
    const id = `chapter_${String(index + 1).padStart(3, '0')}`;
    return `    <navPoint id="navPoint-${playOrder}" playOrder="${playOrder}">
      <navLabel>
        <text>${escapeXml(chapter.title)}</text>
      </navLabel>
      <content src="${id}.xhtml"/>
    </navPoint>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN"
  "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${generateUUID()}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle>
    <text>${escapeXml(metadata.title)}</text>
  </docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`;
}

function generateCss(fontFamily: string = 'Georgia'): string {
  const fontStack = getFontStack(fontFamily);

  return `@charset "UTF-8";

body {
  font-family: ${fontStack};
  line-height: 1.6;
  margin: 0;
  padding: 1em;
}

h1 {
  font-size: 1.5em;
  font-weight: bold;
  margin: 1em 0;
  text-align: center;
}

h2 {
  font-size: 1.2em;
  margin: 1em 0 0.5em 0;
}

p {
  margin: 0 0 1em 0;
  text-indent: 0;
}

blockquote {
  margin: 1em 2em;
  font-style: italic;
}

hr {
  border: none;
  border-top: 1px solid #ccc;
  margin: 1.5em 0;
}`;
}

function getFontStack(fontFamily: string): string {
  const fontStacks = {
    'Georgia': '"Georgia", "Times New Roman", serif',
    'Merriweather': '"Merriweather", "Georgia", serif',
    'Crimson Text': '"Crimson Text", "Times New Roman", serif',
    'Libre Baskerville': '"Libre Baskerville", "Georgia", serif',
    'Source Serif Pro': '"Source Serif Pro", "Georgia", serif'
  };
  
  return fontStacks[fontFamily as keyof typeof fontStacks] || fontStacks.Georgia;
}

/**
 * Convert arbitrary (possibly malformed / HTML4-style) markup into well-formed
 * XHTML so EPUB readers don't choke on things like unclosed <br> or <img> tags.
 * Falls back to escaped plain text if serialization fails.
 */
const ENTITIES: Record<string, string> = {
  nbsp: "&#160;", iexcl: "&#161;", cent: "&#162;", pound: "&#163;", curren: "&#164;", yen: "&#165;",
  brvbar: "&#166;", sect: "&#167;", uml: "&#168;", copy: "&#169;", ordf: "&#170;", laquo: "&#171;",
  not: "&#172;", shy: "&#173;", reg: "&#174;", macr: "&#175;", deg: "&#176;", plusmn: "&#177;",
  sup2: "&#178;", sup3: "&#179;", acute: "&#180;", micro: "&#181;", para: "&#182;", middot: "&#183;",
  cedil: "&#184;", sup1: "&#185;", ordm: "&#186;", raquo: "&#187;", frac14: "&#188;", frac12: "&#189;",
  frac34: "&#190;", iquest: "&#191;", ndash: "&#8211;", mdash: "&#8212;", lsquo: "&#8216;", rsquo: "&#8217;",
  sbquo: "&#8218;", ldquo: "&#8220;", rdquo: "&#8221;", bdquo: "&#8222;", dagger: "&#8224;", Dagger: "&#8225;",
  bull: "&#8226;", hellip: "&#8230;", permil: "&#8240;", lsaquo: "&#8249;", rsaquo: "&#8250;", euro: "&#8364;",
  trade: "&#8482;"
};

function fixEntities(html: string): string {
  return html.replace(/&([a-zA-Z0-9]+);/g, (match, entity) => {
    const lower = entity.toLowerCase();
    if (lower === "amp" || lower === "lt" || lower === "gt" || lower === "quot" || lower === "apos") {
      return match;
    }
    return ENTITIES[entity] || ENTITIES[lower] || `&amp;${entity};`;
  });
}

function toXhtml(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(
      `<div id="__wrap__">${html}</div>`,
      'text/html'
    );
    const wrap = doc.getElementById('__wrap__');
    if (!wrap) return escapeXml(html);

    // Drop things that are never valid/wanted inside an EPUB chapter.
    wrap
      .querySelectorAll('script, style, iframe, ins, form, input, button, noscript, svg, canvas, video, audio')
      .forEach((el) => el.remove());

    // Strip event handlers, microdata, ARIA, and other non-EPUB attributes.
    wrap.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        if (
          name.startsWith('on') ||
          name.startsWith('data-') ||
          name.startsWith('aria-') ||
          name === 'contenteditable' ||
          name === 'itemscope' ||
          name === 'itemprop' ||
          name === 'itemtype' ||
          name === 'itemid' ||
          name === 'itemref' ||
          name === 'role'
        ) {
          el.removeAttribute(attr.name);
        }
      });
    });

    const serialized = new XMLSerializer().serializeToString(wrap);
    // Remove the wrapper element itself, keep its children.
    const inner = fixEntities(
      serialized
        .replace(/^<div[^>]*>/, '')
        .replace(/<\/div>$/, '')
        .replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '')
    );

    // Verify the result actually parses as XML; if not, fall back to text.
    const check = new DOMParser().parseFromString(`<r>${inner}</r>`, 'application/xml');
    if (check.getElementsByTagName('parsererror').length > 0) {
      return escapeXml(wrap.textContent || '');
    }
    return inner;
  } catch {
    return escapeXml(html);
  }
}

function generateChapterXhtml(chapter: ChapterData, fontFamily?: string): string {
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

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .toLowerCase();
}