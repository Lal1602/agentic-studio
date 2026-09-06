import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced'
});

// Clean up noisy elements before converting
turndownService.remove(['script', 'style', 'noscript', 'nav', 'footer', 'iframe']);

export async function scrapeWebsite(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'AgenticStudio/1.0 (Local AI Developer Tool)',
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove hidden or visually noisy elements to save tokens
    $('script, style, nav, footer, header, aside, .sidebar, .ads, svg, img').remove();

    // Extract the main body content. We prefer 'main', 'article', or just 'body'
    let mainContent = $('main').html() || $('article').html() || $('body').html() || html;

    // Convert HTML to Markdown
    const markdown = turndownService.turndown(mainContent);

    // Truncate if it's too massive (Qwen 4B has ~4k-8k context limit)
    // 10000 chars is roughly 2500 tokens.
    if (markdown.length > 10000) {
      return markdown.substring(0, 10000) + "\n\n...[CONTENT TRUNCATED FOR LENGTH]...";
    }

    return markdown;
  } catch (error: any) {
    return `Error scraping website ${url}: ${error.message}`;
  }
}
