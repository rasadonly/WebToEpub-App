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

export async function fetchChapterContent(chapterUrl: string, contentSelector: string): Promise<string> {
  const response = await fetchHtmlContent(chapterUrl, contentSelector, 'content');
  
  if (response.error) {
    throw new Error(`Failed to fetch chapter content: ${response.error}`);
  }

  return response.results?.join(' ') || '';
}