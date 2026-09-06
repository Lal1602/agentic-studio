import { describe, it, expect } from 'vitest';
import { isSameOrigin } from './security';

describe('isSameOrigin', () => {
  it('allows a matching same-origin request', () => {
    expect(isSameOrigin('http://localhost:3000', 'localhost:3000')).toBe(true);
  });

  it('allows a request with no Origin header at all', () => {
    expect(isSameOrigin(null, 'localhost:3000')).toBe(true);
  });

  it('rejects a mismatched external origin', () => {
    expect(isSameOrigin('https://evil.example.com', 'localhost:3000')).toBe(false);
  });

  it('rejects a sandboxed-iframe "null" origin (no allow-same-origin)', () => {
    // A sandboxed iframe without allow-same-origin sends the literal string
    // "null" as its Origin header. new URL("null") does not throw a
    // recognizable host, so this must be rejected, not treated as "no header".
    expect(isSameOrigin('null', 'localhost:3000')).toBe(false);
  });

  it('rejects a garbage/unparseable origin', () => {
    expect(isSameOrigin('not a url', 'localhost:3000')).toBe(false);
  });

  it('is not fooled by a prefix match (host that merely starts with the same string)', () => {
    expect(isSameOrigin('http://localhost:3000.evil.com', 'localhost:3000')).toBe(false);
  });
});
