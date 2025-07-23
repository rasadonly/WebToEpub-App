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
  const maxRetries = 5;
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Add random delay to avoid pattern detection
      const baseDelay = attempt * 1000;
      const randomDelay = Math.random() * 1000;
      
      if (attempt > 1) {
        console.log(`Attempt ${attempt} for chapter, waiting ${Math.round((baseDelay + randomDelay) / 1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, baseDelay + randomDelay));
      }

      const response = await fetchHtmlContent(chapterUrl, contentSelector, 'content');
      
      if (response.error) {
        lastError = new Error(`Failed to fetch chapter content: ${response.error}`);
        console.log(`Attempt ${attempt} failed with error: ${response.error}`);
        if (attempt < maxRetries) {
          continue;
        }
        throw lastError;
      }

      const content = response.results?.join(' ') || '';
      
      // If content is empty or too short, retry unless it's the last attempt
      if ((!content.trim() || content.trim().length < 50) && attempt < maxRetries) {
        console.log(`Attempt ${attempt} returned insufficient content (${content.trim().length} chars), retrying...`);
        continue;
      }
      
      if (content.trim()) {
        console.log(`Successfully fetched chapter content (${content.trim().length} chars) on attempt ${attempt}`);
        return content;
      }
      
      // On last attempt, return whatever we got
      return content;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');
      console.log(`Attempt ${attempt} failed with exception: ${lastError.message}`);
      if (attempt < maxRetries) {
        continue;
      }
    }
  }
  
  // If all retries failed, return empty string to allow conversion to continue
  console.warn(`Failed to fetch content after ${maxRetries} attempts for URL: ${chapterUrl}`);
  return '';
}