const WORKER_URL = 'https://fragrant-frost-f292.tufive.workers.dev';

export interface WorkerResponse {
  results?: string[];
  error?: string;
}

export async function fetchHtmlContent(url: string, selector: string = 'body', mode: string = 'content'): Promise<WorkerResponse> {
  try {
    const params = new URLSearchParams({
      url,
      selector,
      mode
    });

    const response = await fetch(`${WORKER_URL}?${params}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Worker API error:', error);
    return { 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    };
  }
}

export async function fetchChapterLinks(tocUrl: string, linkSelector: string): Promise<string[]> {
  const response = await fetchHtmlContent(tocUrl, linkSelector, 'link');
  
  if (response.error) {
    throw new Error(`Failed to fetch chapter links: ${response.error}`);
  }

  return response.results || [];
}

export async function fetchChapterContent(chapterUrl: string, contentSelector: string, retries = 3): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchHtmlContent(chapterUrl, contentSelector, 'content');
      
      if (response.error) {
        if (attempt < retries) {
          console.log(`Content fetch failed (${response.error}), retrying... (${attempt + 1}/${retries})`);
          await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
          continue;
        }
        throw new Error(`Failed to fetch chapter content: ${response.error}`);
      }

      const content = response.results?.join(' ') || '';
      
      // Check if content is empty or too short
      if (!content || content.trim().length < 20) {
        if (attempt < retries) {
          console.log(`Content too short (${content.trim().length} chars), retrying... (${attempt + 1}/${retries})`);
          await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
          continue;
        }
        // Don't throw error for empty content, just return empty string to continue processing
        console.warn(`Content appears to be empty after ${retries + 1} attempts, skipping chapter`);
        return '';
      }

      return content;
    } catch (error) {
      if (attempt < retries) {
        console.log(`Fetch attempt ${attempt + 1} failed, retrying...`, error);
        await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
        continue;
      }
      // Don't throw error for individual chapter failures, return empty to continue
      console.warn(`All retry attempts failed for chapter: ${chapterUrl}`, error);
      return '';
    }
  }
  
  return '';
}