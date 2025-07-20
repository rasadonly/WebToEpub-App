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

  // Add mimetype (uncompressed) - Fixed for Android compatibility
  zip.file('mimetype', 'application/epub+zip', { 
    compression: 'STORE',
    compressionOptions: { level: 0 }
  });

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

  // Generate and download with proper EPUB MIME type for Android
  const blob = await zip.generateAsync({ 
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
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

/* Beautiful EPUB styles for all devices */
body {
  font-family: ${fontStack};
  line-height: 1.7;
  margin: 0;
  padding: 2em;
  color: #2c3e50;
  background-color: #fdfdfd;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
}

/* Responsive margins */
@media screen and (max-width: 600px) {
  body {
    padding: 1em;
    line-height: 1.6;
  }
}

h1 {
  font-size: 2em;
  font-weight: 700;
  margin: 1.5em 0 1em 0;
  text-align: center;
  color: #34495e;
  border-bottom: 3px solid #3498db;
  padding-bottom: 0.5em;
  line-height: 1.3;
}

h2 {
  font-size: 1.5em;
  font-weight: 600;
  margin: 2em 0 1em 0;
  color: #34495e;
  line-height: 1.4;
}

h3 {
  font-size: 1.2em;
  font-weight: 600;
  margin: 1.5em 0 0.5em 0;
  color: #34495e;
}

p {
  margin: 0 0 1.2em 0;
  text-align: justify;
  text-indent: 1.5em;
  orphans: 2;
  widows: 2;
}

/* First paragraph after headers shouldn't be indented */
h1 + p, h2 + p, h3 + p {
  text-indent: 0;
  margin-top: 0.5em;
}

.chapter-content {
  max-width: 45em;
  margin: 0 auto;
  overflow-wrap: break-word;
}

/* Better typography */
em, i {
  font-style: italic;
}

strong, b {
  font-weight: 700;
}

/* Quote styling */
blockquote {
  margin: 1.5em 2em;
  padding: 1em;
  border-left: 4px solid #3498db;
  background-color: #f8f9fa;
  font-style: italic;
}

/* Lists */
ul, ol {
  margin: 1em 0;
  padding-left: 2em;
}

li {
  margin: 0.5em 0;
}

/* Links */
a {
  color: #3498db;
  text-decoration: underline;
}

/* Horizontal rules */
hr {
  border: none;
  border-top: 1px solid #bdc3c7;
  margin: 2em 0;
}

/* Page breaks for print/export */
.page-break {
  page-break-before: always;
}

/* Dark mode support */
@media (prefers-color-scheme: dark) {
  body {
    background-color: #1a1a1a;
    color: #e8e8e8;
  }
  
  h1, h2, h3 {
    color: #f0f0f0;
  }
  
  h1 {
    border-bottom-color: #4a90e2;
  }
  
  blockquote {
    background-color: #2a2a2a;
    border-left-color: #4a90e2;
  }
  
  hr {
    border-top-color: #404040;
  }
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

function generateChapterXhtml(chapter: ChapterData, fontFamily?: string): string {
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