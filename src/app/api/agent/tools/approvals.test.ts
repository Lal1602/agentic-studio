import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('approval tokens', () => {
  let approvals: typeof import('./approvals');

  beforeEach(async () => {
    vi.resetModules();
    approvals = await import('./approvals');
  });

  it('accepts a token when chatId, name, and args all match exactly', () => {
    const token = approvals.createApprovalToken('chat-1', 'run_terminal_command', { command: 'ls' });
    expect(approvals.consumeApprovalToken(token, 'chat-1', 'run_terminal_command', { command: 'ls' })).toBe(true);
  });

  it('is single-use — a second attempt with the same token fails', () => {
    const token = approvals.createApprovalToken('chat-1', 'run_terminal_command', { command: 'ls' });
    expect(approvals.consumeApprovalToken(token, 'chat-1', 'run_terminal_command', { command: 'ls' })).toBe(true);
    expect(approvals.consumeApprovalToken(token, 'chat-1', 'run_terminal_command', { command: 'ls' })).toBe(false);
  });

  it('rejects a token replayed against a different (more dangerous) command', () => {
    const token = approvals.createApprovalToken('chat-1', 'run_terminal_command', { command: 'ls' });
    expect(
      approvals.consumeApprovalToken(token, 'chat-1', 'run_terminal_command', { command: 'rm -rf /' })
    ).toBe(false);
  });

  it('rejects a token replayed against a different chat', () => {
    const token = approvals.createApprovalToken('chat-1', 'run_terminal_command', { command: 'ls' });
    expect(approvals.consumeApprovalToken(token, 'chat-2', 'run_terminal_command', { command: 'ls' })).toBe(false);
  });

  it('rejects a token replayed against a different tool name', () => {
    const token = approvals.createApprovalToken('chat-1', 'run_terminal_command', { command: 'ls' });
    expect(approvals.consumeApprovalToken(token, 'chat-1', 'write_local_file', { command: 'ls' })).toBe(false);
  });

  it('rejects an unknown / made-up token', () => {
    expect(approvals.consumeApprovalToken('not-a-real-token', 'chat-1', 'run_terminal_command', { command: 'ls' })).toBe(false);
  });

  it('rejects a token after it expires', () => {
    vi.useFakeTimers();
    try {
      const token = approvals.createApprovalToken('chat-1', 'run_terminal_command', { command: 'ls' });
      vi.advanceTimersByTime(5 * 60 * 1000 + 1); // just past the 5-minute TTL
      expect(approvals.consumeApprovalToken(token, 'chat-1', 'run_terminal_command', { command: 'ls' })).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
