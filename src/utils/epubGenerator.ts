import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { ChapterData, EpubMetadata } from '@/types';

export async function generateEpub(
  chapters: ChapterData[],
  metadata: EpubMetadata
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
  oebps.file('style.css', generateCss());

  // Add chapters
  chapters.forEach((chapter, index) => {
    const filename = `chapter_${String(index + 1).padStart(3, '0')}.xhtml`;
    oebps.file(filename, generateChapterXhtml(chapter));
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

function generateCss(): string {
  return `body {
  font-family: Georgia, serif;
  line-height: 1.6;
  margin: 2em;
  color: #333;
}

h1 {
  font-size: 1.8em;
  margin-bottom: 1em;
  text-align: center;
  border-bottom: 2px solid #333;
  padding-bottom: 0.5em;
}

h2 {
  font-size: 1.4em;
  margin: 1.5em 0 1em 0;
}

p {
  margin: 1em 0;
  text-align: justify;
  text-indent: 1.5em;
}

.chapter-content {
  max-width: 40em;
  margin: 0 auto;
}`;
}

function generateChapterXhtml(chapter: ChapterData): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${escapeXml(chapter.title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <h1>${escapeXml(chapter.title)}</h1>
  <div class="chapter-content">
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