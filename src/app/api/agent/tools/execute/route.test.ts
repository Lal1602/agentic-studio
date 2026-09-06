import { describe, it, expect, vi } from 'vitest';
import { POST } from './route';
import { createApprovalToken } from '../approvals';

function makeReq(body: any, headers: Record<string, string> = {}) {
  return new Request('http://localhost:3000/api/agent/tools/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/agent/tools/execute', () => {
  it('rejects a cross-origin request outright, before even checking the token', async () => {
    const res = await POST(makeReq(
      { chatId: 'c1', token: 'whatever', name: 'run_terminal_command', args: { command: 'echo hi' } },
      { origin: 'https://evil.example.com', host: 'localhost:3000' }
    ));
    expect(res.status).toBe(403);
  });

  it('rejects a tool that is not on the dangerous-tools allow-list, even with no token at all', async () => {
    const res = await POST(makeReq(
      { chatId: 'c1', name: 'read_local_file', args: { filepath: 'x.txt' } },
      { host: 'localhost:3000' }
    ));
    expect(res.status).toBe(403);
  });

  it('rejects a missing/garbage token for a dangerous tool', async () => {
    const res = await POST(makeReq(
      { chatId: 'c1', token: 'not-a-real-token', name: 'run_terminal_command', args: { command: 'echo hi' } },
      { host: 'localhost:3000' }
    ));
    expect(res.status).toBe(401);
  });

  it('runs the tool when a same-origin request presents a valid, matching approval token', async () => {
    const args = { command: 'echo approved-run' };
    const token = createApprovalToken('c1', 'run_terminal_command', args);
    const res = await POST(makeReq(
      { chatId: 'c1', token, name: 'run_terminal_command', args },
      { origin: 'http://localhost:3000', host: 'localhost:3000' }
    ));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toContain('approved-run');
  });

  it('refuses to reuse the same approval token twice', async () => {
    const args = { command: 'echo once' };
    const token = createApprovalToken('c1', 'run_terminal_command', args);
    const first = await POST(makeReq({ chatId: 'c1', token, name: 'run_terminal_command', args }, { host: 'localhost:3000' }));
    expect(first.status).toBe(200);
    const second = await POST(makeReq({ chatId: 'c1', token, name: 'run_terminal_command', args }, { host: 'localhost:3000' }));
    expect(second.status).toBe(401);
  });
});
