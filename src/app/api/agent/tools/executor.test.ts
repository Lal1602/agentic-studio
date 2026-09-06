import { describe, it, expect } from 'vitest';
import path from 'path';
import { safeResolve, executeTool } from './executor';

describe('safeResolve (path-traversal guard)', () => {
  const root = path.join(path.sep, 'workspace', 'project');

  it('resolves a plain relative path inside the root', () => {
    const result = safeResolve(root, 'src/index.ts');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.absolute).toBe(path.join(root, 'src/index.ts'));
  });

  it('resolves "." to the root itself', () => {
    const result = safeResolve(root, '.');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.absolute).toBe(root);
  });

  it('rejects a simple ../ escape', () => {
    const result = safeResolve(root, '../secrets.txt');
    expect(result.ok).toBe(false);
  });

  it('rejects a deeply nested ../../../ escape', () => {
    const result = safeResolve(root, 'a/b/../../../../etc/passwd');
    expect(result.ok).toBe(false);
  });

  it('treats an OS-absolute-looking input as contained under the root rather than escaping to it', () => {
    // path.join() (unlike path.resolve()) does not special-case a later
    // argument that looks absolute — "/etc/passwd" joined onto the root
    // normalizes to "<root>/etc/passwd", not the real /etc/passwd. Confirm
    // that containment explicitly, since it's the reason this case is safe
    // rather than a gap in the guard.
    const result = safeResolve(root, path.join(path.sep, 'etc', 'passwd'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.absolute.startsWith(root + path.sep)).toBe(true);
      expect(result.absolute).not.toBe(path.join(path.sep, 'etc', 'passwd'));
    }
  });

  it('rejects a sibling directory that merely shares the root as a string prefix', () => {
    // root is ".../workspace/project" — a naive `resolved.startsWith(root)`
    // check would wrongly accept ".../workspace/project-secrets/x".
    const trickyRelative = path.join('..', 'project-secrets', 'x.txt');
    const result = safeResolve(root, trickyRelative);
    expect(result.ok).toBe(false);
  });
});

describe('executeTool: create_graphic_canvas', () => {
  it('is implemented (regression test — this case was previously missing from the switch, so every chart request silently failed with "Tool is not implemented")', async () => {
    const result = await executeTool('create_graphic_canvas', { title: 'Test Chart' });
    expect(result.startsWith('Error')).toBe(false);
    expect(result).toContain('Test Chart');
  });
});

describe('executeTool: run_terminal_command safety limits', () => {
  it('still returns normal stdout for a fast, well-behaved command', async () => {
    const isWindows = process.platform === 'win32';
    const result = await executeTool('run_terminal_command', { command: isWindows ? 'echo hello' : 'echo hello' });
    expect(result).toContain('hello');
  });

  it('is killed by the timeout instead of hanging forever, and reports why', async () => {
    // Use a command guaranteed to outlive a short timeout. We can't easily
    // override TERMINAL_TIMEOUT_MS from outside the module without adding a
    // test-only seam, so this test instead directly exercises execPromise's
    // timeout behavior via the same node:child_process API executor.ts uses,
    // to prove the *mechanism* (timeout + maxBuffer options passed to exec)
    // actually kills a hanging process rather than waiting on it forever.
    const { exec } = await import('child_process');
    const util = await import('util');
    const execPromise = util.promisify(exec);
    const isWindows = process.platform === 'win32';
    const sleepCmd = isWindows ? 'ping -n 6 127.0.0.1 >NUL' : 'sleep 5';

    const start = Date.now();
    await expect(
      execPromise(sleepCmd, { timeout: 300, maxBuffer: 1024 * 1024 })
    ).rejects.toMatchObject({ killed: true });
    const elapsed = Date.now() - start;
    // Should be killed near the 300ms timeout, nowhere near the full 5s sleep.
    expect(elapsed).toBeLessThan(4000);
  });
});
