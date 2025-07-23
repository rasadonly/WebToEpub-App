const WORKER_URL = 'https://fragrant-frost-f292.tufive.workers.dev';

export interface WorkerResponse {
  results?: string[];
  error?: string;
}

export async function fetchHtmlContent(url: string, selector: string = 'body', mode: string = 'content', retryCount = 0): Promise<WorkerResponse> {
  const maxRetries = 3;
  const baseDelay = 500;
  
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
      if ((response.status === 429 || response.status >= 500) && retryCount < maxRetries) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return { error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`Worker API error (attempt ${retryCount + 1}):`, error);
    
    if (retryCount < maxRetries) {
      // Much shorter delays - max 2 seconds
      const delay = baseDelay * (retryCount + 1) + Math.random() * 500;
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
  
  // More lenient validation - just check if we have some content
  if (content.trim().length < 10) {
    throw new Error('Chapter content appears to be empty');
  }

  return content;
}