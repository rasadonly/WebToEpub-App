// Simple content cleaner (replacing full Readability.js for now)
export function cleanHtmlContent(
  htmlContent: string, 
  removeSelectors: string[] = []
): string {
  // Create a temporary DOM element to parse HTML
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');
  
  // Remove unwanted elements
  const defaultRemoveSelectors = [
    'script', 'style', 'nav', 'header', 'footer', 
    '.ad', '.ads', '.advertisement', '.sidebar',
    '.comment', '.comments', '.social', '.share'
  ];
  
  const allRemoveSelectors = [...defaultRemoveSelectors, ...removeSelectors];
  
  allRemoveSelectors.forEach(selector => {
    const elements = doc.querySelectorAll(selector);
    elements.forEach(el => el.remove());
  });
  
  // Get the body content
  const body = doc.body || doc.documentElement;
  
  // Clean up the text
  let content = body.innerHTML;
  
  // Remove excessive whitespace
  content = content.replace(/\s+/g, ' ');
  content = content.replace(/\n\s*\n/g, '\n');
  content = content.trim();
  
  return content;
}

export function extractTextContent(htmlContent: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');
  return doc.body?.textContent?.trim() || '';
}

export function createChapterHtml(title: string, content: string): string {
  return `
    <html xmlns="http://www.w3.org/1999/xhtml">
    <head>
      <title>${escapeHtml(title)}</title>
      <meta charset="utf-8"/>
    </head>
    <body>
      <h1>${escapeHtml(title)}</h1>
      <div class="chapter-content">
        ${content}
      </div>
    </body>
    </html>
  `;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}