import * as cheerio from 'cheerio';

export async function searchWeb(query: string, maxResults: number = 5): Promise<string> {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (!res.ok) {
      return `Error searching web: HTTP ${res.status}`;
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const results: Array<{ title: string; snippet: string; url: string }> = [];

    $('.result').each((_, el) => {
      const title = $(el).find('.result__title').text().trim();
      const snippet = $(el).find('.result__snippet').text().trim();
      let rawUrl = $(el).find('.result__url').attr('href');
      
      let url = rawUrl;
      if (rawUrl && rawUrl.includes('uddg=')) {
        try {
          const urlObj = new URL(rawUrl, 'https://duckduckgo.com');
          url = decodeURIComponent(urlObj.searchParams.get('uddg') || rawUrl);
        } catch (e) {
          url = rawUrl;
        }
      }

      if (title && url && snippet) {
        results.push({ title, snippet, url });
      }
    });

    if (results.length === 0) {
      return "No results found for your query.";
    }

    // Format as markdown for the LLM
    const topResults = results.slice(0, maxResults);
    let output = `Found ${topResults.length} results for "${query}":\n\n`;
    
    topResults.forEach((res, index) => {
      output += `${index + 1}. **[${res.title}](${res.url})**\n`;
      output += `   *Snippet:* ${res.snippet}\n\n`;
    });

    return output;
  } catch (error: any) {
    return `Error executing search: ${error.message}`;
  }
}
