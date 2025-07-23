const WORKER_URL = 'https://fragrant-frost-f292.tufive.workers.dev';

export interface WorkerResponse {
  results?: string[];
  error?: string;
}

export async function fetchHtmlContent(url: string, selector: string = 'body', mode: string = 'content', retryCount = 0): Promise<WorkerResponse> {
  const maxRetries = 5;
  const baseDelay = 1000;
  
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
      if (response.status === 429 || response.status >= 500) {
        // Rate limit or server error - retry
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Validate content quality
    if (mode === 'content' && data.results) {
      const contentLength = data.results.join(' ').trim().length;
      if (contentLength < 100 && retryCount < maxRetries) {
        // Content too short, likely failed scraping - retry
        throw new Error('Content too short, retrying...');
      }
    }
    
    return data;
  } catch (error) {
    console.error(`Worker API error (attempt ${retryCount + 1}):`, error);
    
    if (retryCount < maxRetries) {
      // Calculate delay with exponential backoff and jitter
      const delay = baseDelay * Math.pow(2, retryCount) + Math.random() * 1000;
      console.log(`Retrying in ${Math.round(delay)}ms...`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchHtmlContent(url, selector, mode, retryCount + 1);
    }
    
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

export async function fetchChapterContent(chapterUrl: string, contentSelector: string): Promise<string> {
  const response = await fetchHtmlContent(chapterUrl, contentSelector, 'content');
  
  if (response.error) {
    throw new Error(`Failed to fetch chapter content: ${response.error}`);
  }

  const content = response.results?.join(' ') || '';
  
  // Additional validation for content quality
  if (content.trim().length < 50) {
    throw new Error('Chapter content appears to be empty or too short');
  }

  return content;
}