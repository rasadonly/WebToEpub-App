export interface WorkerResponse {
  results?: string[];
  error?: string;
}

function cleanText(hostname: string, text: string): string {
  if (hostname.includes("wtr-lab.com")) {
    return text.replace(/Advertisement/g, "").replace(/\s+/g, " ").trim();
  }

  if (
    hostname.includes("novelfull") ||
    hostname.includes("novelbin") ||
    hostname.includes("novlove")
  ) {
    text = text.replace(
      /window\.pubfuturetag[\s\S]*?push\([^)]*\);?/g,
      ""
    );
    text = text.replace(/Translated by.*?Source.*?novelbin/gi, "");
    return text.replace(/\s+/g, " ").trim();
  }

  return text.trim();
}

export async function fetchHtmlContent(url: string, selector: string = 'body', mode: string = 'content'): Promise<WorkerResponse> {
  try {
    const targetParsed = new URL(url);
    const { hostname, pathname } = targetParsed;
    let results: string[] = [];

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "Accept": "text/html",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      return { error: `Failed to fetch: ${response.status}` };
    }

    if (mode === "link") {
      if (hostname.includes("wtr-lab.com")) {
        const parts = pathname.split("/").filter(Boolean);
        const seriePart = parts.find(p => p.startsWith("serie-"));
        const slug = parts[parts.length - 1].split("?")[0];
        const id = seriePart?.slice(6);
        const language = parts[0];
        
        if (id) {
          const apiUrl = `https://wtr-lab.com/api/chapters/${id}`;
          const apiResp = await fetch(apiUrl);
          const json = await apiResp.json();
          results = json.chapters.map(
            (a: any) => `https://wtr-lab.com/${language}/serie-${id}/${slug}/${a.order}`
          );
        }
      } else if (hostname.includes("novelfull")) {
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // Get total pages
        let limit = 1;
        const lastPageEl = doc.querySelector("li.last a");
        if (lastPageEl) {
          const page = lastPageEl.getAttribute("data-page") || 
                      new URL(lastPageEl.getAttribute("href") || "", url).searchParams.get("page");
          if (page) {
            limit = parseInt(page) + 1;
          }
        }

        // Fetch all pages in parallel for speed
        const pagePromises = [];
        for (let i = 1; i <= limit; i++) {
          const tocUrl = `${url}?page=${i}&per-page=50`;
          pagePromises.push(
            fetch(tocUrl, {
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
                "Accept": "text/html",
                "Accept-Language": "en-US,en;q=0.9",
              },
            }).then(res => res.text())
          );
        }

        const pageHtmls = await Promise.all(pagePromises);
        
        for (const pageHtml of pageHtmls) {
          const pageDoc = parser.parseFromString(pageHtml, 'text/html');
          const links = pageDoc.querySelectorAll("ul.list-chapter a");
          links.forEach(link => {
            const href = link.getAttribute("href");
            if (href) {
              results.push(`https://novelfull.com${href}`);
            }
          });
        }
      } else if (hostname.includes("novelbin") || hostname.includes("novlove")) {
        let slug = pathname.split("/").filter(Boolean).pop();
        if (slug) {
          let baseHost = hostname.includes("novelbin") ? "https://novelbin.com" : "https://novlove.com";
          const ajaxUrl = `${baseHost}/ajax/chapter-archive?novelId=${slug}`;
          const ajaxResp = await fetch(ajaxUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
              "Accept": "text/html",
            },
          });
          const html = await ajaxResp.text();
          const regex = /<a\s+[^>]*href=["']([^"']+)["']/gi;
          let match;
          while ((match = regex.exec(html)) !== null) {
            results.push(match[1]);
          }
        }
      } else {
        // Fallback generic
        const html = await response.text();
        const regex = /<a\s+[^>]*href=["']([^"']+)["']/gi;
        let match;
        while ((match = regex.exec(html)) !== null) {
          results.push(match[1]);
        }
      }
    } else {
      // Content extraction
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      const selectors = selector.split(",").map(s => s.trim());
      let textChunks: string[] = [];
      
      for (const sel of selectors) {
        const elements = doc.querySelectorAll(sel);
        elements.forEach(element => {
          if (element.textContent) {
            textChunks.push(element.textContent);
          }
        });
      }
      
      const joined = textChunks.join("\n");
      const cleaned = cleanText(hostname, joined);
      results = [cleaned];
    }

    return { results };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error occurred' };
  }
}

export async function fetchChapterLinks(tocUrl: string, linkSelector: string): Promise<string[]> {
  const response = await fetchHtmlContent(tocUrl, linkSelector, 'link');
  
  if (response.error) {
    throw new Error(`Failed to fetch chapter links: ${response.error}`);
  }

  return response.results || [];
}

export async function fetchChapterContent(chapterUrl: string, contentSelector: string): Promise<string> {
  const response = await fetchHtmlContent(chapterUrl, contentSelector, 'content');
  
  if (response.error) {
    throw new Error(`Failed to fetch chapter content: ${response.error}`);
  }

  const content = response.results?.join(' ') || '';
  
  if (content.trim().length < 10) {
    throw new Error('Chapter content appears to be empty');
  }

  return content;
}