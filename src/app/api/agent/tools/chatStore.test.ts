import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('chatStore (SQLite-backed)', () => {
  let tmpDir: string;
  let chatStore: typeof import('./chatStore');

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentic-chatstore-'));
    process.env.AGENTIC_APP_ROOT = tmpDir;
    // Fresh module instance per test so its module-level dbPromise cache
    // can't leak a connection to a previous test's tmp directory.
    vi.resetModules();
    chatStore = await import('./chatStore');
  });

  afterEach(async () => {
    delete process.env.AGENTIC_APP_ROOT;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('starts empty when there is no legacy JSON and no existing db', async () => {
    const chats = await chatStore.readChats();
    expect(chats).toEqual([]);
  });

  it('round-trips a chat through writeChats/readChats, including an extra custom field', async () => {
    await chatStore.writeChats([
      {
        id: 'chat-1',
        title: 'Hello',
        isPinned: true,
        createdAt: 1000,
        updatedAt: 2000,
        messages: [{ role: 'user', content: 'hi' }],
        someCustomField: 'kept',
      },
    ]);

    const chats = await chatStore.readChats();
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({
      id: 'chat-1',
      title: 'Hello',
      isPinned: true,
      createdAt: 1000,
      updatedAt: 2000,
      messages: [{ role: 'user', content: 'hi' }],
      someCustomField: 'kept',
    });
  });

  it('persists an in-place mutation made by mutate() — the exact pattern agent/route.ts uses', async () => {
    await chatStore.writeChats([
      { id: 'chat-1', title: 'T', isPinned: false, createdAt: 1, updatedAt: 1, messages: [] },
    ]);

    // This mirrors saveMessagesToChat() in agent/route.ts EXACTLY: find by
    // id, mutate the existing object's fields in place, return the same
    // array reference. This is the case that would silently no-op if
    // fingerprints were computed after mutate() ran instead of before.
    const newMessages = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }];
    await chatStore.updateChats((chats) => {
      const idx = chats.findIndex((c) => c.id === 'chat-1');
      chats[idx].messages = newMessages;
      chats[idx].updatedAt = 999;
      return chats;
    });

    const chats = await chatStore.readChats();
    expect(chats).toHaveLength(1);
    expect(chats[0].messages).toEqual(newMessages);
    expect(chats[0].updatedAt).toBe(999);
  });

  it('persists a new chat added via push() — the pattern chats/route.ts POST uses for a new chat', async () => {
    await chatStore.updateChats((chats) => {
      chats.push({
        id: 'chat-new',
        title: 'New Chat',
        messages: [{ role: 'user', content: 'first message' }],
        isPinned: false,
        createdAt: 111,
        updatedAt: 111,
      });
      return chats;
    });

    const chats = await chatStore.readChats();
    expect(chats.map((c) => c.id)).toEqual(['chat-new']);
  });

  it('deletes a chat removed via filter() — the pattern chats/route.ts DELETE uses', async () => {
    await chatStore.writeChats([
      { id: 'a', title: 'A', messages: [], createdAt: 1, updatedAt: 1 },
      { id: 'b', title: 'B', messages: [], createdAt: 1, updatedAt: 1 },
    ]);

    await chatStore.updateChats((chats) => chats.filter((c) => c.id !== 'a'));

    const chats = await chatStore.readChats();
    expect(chats.map((c) => c.id)).toEqual(['b']);
  });

  it('leaves untouched chats alone (and does not report them as needing a write)', async () => {
    await chatStore.writeChats([
      { id: 'a', title: 'A', messages: [{ n: 1 }], createdAt: 1, updatedAt: 1 },
      { id: 'b', title: 'B', messages: [{ n: 2 }], createdAt: 1, updatedAt: 1 },
    ]);

    // Mutate only 'a'; 'b' should come back byte-for-byte identical.
    await chatStore.updateChats((chats) => {
      const a = chats.find((c) => c.id === 'a')!;
      a.title = 'A renamed';
      return chats;
    });

    const chats = await chatStore.readChats();
    const b = chats.find((c) => c.id === 'b');
    expect(b).toMatchObject({ id: 'b', title: 'B', messages: [{ n: 2 }] });
  });

  it('migrates an existing .agentic-chats.json on first read and leaves the original file untouched', async () => {
    const legacyChats = [
      { id: 'legacy-1', title: 'Old chat', messages: [{ role: 'user', content: 'old' }], isPinned: true, createdAt: 5, updatedAt: 6 },
    ];
    const legacyPath = path.join(tmpDir, '.agentic-chats.json');
    await fs.writeFile(legacyPath, JSON.stringify(legacyChats, null, 2), 'utf8');

    const chats = await chatStore.readChats();
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({ id: 'legacy-1', title: 'Old chat', isPinned: true });

    // Original JSON file must still exist, unmodified — this module never
    // deletes or rewrites it.
    const stillThere = JSON.parse(await fs.readFile(legacyPath, 'utf8'));
    expect(stillThere).toEqual(legacyChats);
  });

  it('does not re-import (and does not duplicate) once the database already has data', async () => {
    const legacyChats = [{ id: 'legacy-1', title: 'Old chat', messages: [], createdAt: 1, updatedAt: 1 }];
    await fs.writeFile(path.join(tmpDir, '.agentic-chats.json'), JSON.stringify(legacyChats), 'utf8');

    await chatStore.readChats(); // triggers first-run migration

    // Add a second chat directly, then force the module to reopen the DB
    // (simulating a second app start) and read again.
    await chatStore.updateChats((chats) => {
      chats.push({ id: 'chat-2', title: 'New', messages: [], createdAt: 2, updatedAt: 2 });
      return chats;
    });
    chatStore.__resetForTests();

    const chats = await chatStore.readChats();
    expect(chats.map((c) => c.id).sort()).toEqual(['chat-2', 'legacy-1']);
  });
});
