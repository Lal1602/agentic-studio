import { describe, it, expect } from 'vitest';
import { isDangerousTool, NAMED_DANGEROUS_TOOLS } from './dangerousTools';

describe('isDangerousTool', () => {
  it('flags every explicitly named dangerous tool', () => {
    for (const name of NAMED_DANGEROUS_TOOLS) {
      expect(isDangerousTool(name)).toBe(true);
    }
  });

  it('flags every MCP tool regardless of name', () => {
    expect(isDangerousTool('mcp__filesystem__read_file')).toBe(true);
    expect(isDangerousTool('mcp__anything__delete_everything')).toBe(true);
  });

  it('does not flag ordinary read-only / canvas tools', () => {
    for (const name of [
      'read_local_file',
      'list_directory',
      'grep_codebase',
      'search_web',
      'scrape_website',
      'draw_diagram',
      'render_spreadsheet',
      'create_graphic_canvas',
      'open_code_editor',
      'create_live_preview',
      'write_rich_document',
    ]) {
      expect(isDangerousTool(name)).toBe(false);
    }
  });
});
