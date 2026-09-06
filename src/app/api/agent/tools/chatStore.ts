import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { open } from 'sqlite';
import type { Database } from 'sqlite';
import sqlite3 from 'sqlite3';

/**
 * SQLite-backed chat history store.
 *
 * Chat history used to live in a single .agentic-chats.json file that was
 * fully re-parsed and fully re-serialized+rewritten to disk on every single
 * update (saveMessagesToChat in agent/route.ts alone calls this multiple
 * times per conversation turn, and every action in chats/route.ts calls it
 * too). That file had already grown past 26MB in normal use. Rewriting a
 * growing multi-megabyte JSON blob to disk that often is slow and, because
 * it's a single write-the-whole-file operation with no transaction, a crash
 * or kill mid-write can corrupt the ENTIRE chat history — not just the one
 * chat being saved at that moment.
 *
 * This module keeps the exact same exported API (readChats / writeChats /
 * updateChats, same shapes) so callers (agent/route.ts, chats/route.ts)
 * don't need to change, but backs it with SQLite: each chat is its own row,
 * updateChats() only writes the rows that actually changed (diffed by id
 * against a fingerprint of what was read, taken *before* mutate() runs —
 * important, because mutate() is allowed to (and does, in agent/route.ts)
 * mutate chat objects in place, so diffing against live references after
 * the fact would always see "no change"), and every write happens inside a
 * transaction — a crash mid-write can't corrupt chats that weren't being
 * touched.
 *
 * On first run, if the database is empty and a legacy .agentic-chats.json
 * file exists, its contents are imported once. The legacy file is left on
 * disk untouched afterwards (this module never deletes or modifies it) —
 * once you've confirmed chat history looks right in the app, it's safe to
 * delete it yourself.
 */

export interface StoredChat {
  id: string;
  title?: string;
  isPinned?: boolean;
  createdAt?: number;
  updatedAt?: number;
  messages: any[];
  // Callers have historically stashed extra fields on a chat object; those
  // round-trip through the `extra` column untouched.
  [key: string]: any;
}

/**
 * Root directory this store's files live in. Reads process.cwd() lazily
 * (rather than once at module load, the way the old settings.ts/chatStore.ts
 * do with a top-level const) so tests can point it at a scratch directory
 * via AGENTIC_APP_ROOT without needing to fork the process. In production
 * this is equivalent to reading it once, since cwd doesn't change during
 * the life of the `next` process.
 */
function appRoot(): string {
  return process.env.AGENTIC_APP_ROOT || process.cwd();
}

function dbFilePath(): string {
  return path.join(appRoot(), '.agentic-chats.db');
}

function legacyJsonPath(): string {
  return path.join(appRoot(), '.agentic-chats.json');
}

let dbPromise: Promise<Database> | null = null;

async function migrateFromLegacyJson(db: Database): Promise<void> {
  const row = await db.get<{ c: number }>('SELECT COUNT(*) as c FROM chats');
  if (row && row.c > 0) return; // already has data — never let a stale JSON snapshot clobber live rows

  const legacyPath = legacyJsonPath();
  if (!existsSync(legacyPath)) return; // fresh install, nothing to import

  let raw: string;
  try {
    raw = await fs.readFile(legacyPath, 'utf8');
  } catch (e) {
    console.error('[ChatStore] Found legacy .agentic-chats.json but could not read it — skipping migration:', e);
    return;
  }

  let chats: any[];
  try {
    chats = JSON.parse(raw);
  } catch (e) {
    console.error('[ChatStore] Legacy .agentic-chats.json exists but is not valid JSON — skipping migration:', e);
    return;
  }
  if (!Array.isArray(chats) || chats.length === 0) return;

  await db.exec('BEGIN IMMEDIATE');
  try {
    const stmt = await db.prepare(
      'INSERT OR REPLACE INTO chats (id, title, is_pinned, created_at, updated_at, extra, messages) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    try {
      for (const c of chats) {
        if (!c || typeof c !== 'object' || !c.id) continue;
        const r = chatToRow(c);
        await stmt.run(r.id, r.title, r.is_pinned, r.created_at, r.updated_at, r.extra, r.messages);
      }
    } finally {
      await stmt.finalize();
    }
    await db.exec('COMMIT');
    console.log(
      `[ChatStore] Migrated ${chats.length} chat(s) from .agentic-chats.json into SQLite (.agentic-chats.db). ` +
      `The old JSON file was left untouched — safe to delete once you've confirmed history looks right in the app.`
    );
  } catch (e) {
    await db.exec('ROLLBACK');
    // Table stays empty, so migration will simply retry from scratch next
    // time getDb() runs (e.g. next app start) instead of leaving a half
    // -imported state around.
    console.error('[ChatStore] Migration from legacy JSON failed and was rolled back. Will retry on next start.', e);
  }
}

async function openDb(): Promise<Database> {
  await fs.mkdir(appRoot(), { recursive: true }).catch(() => {});
  const db = await open({ filename: dbFilePath(), driver: sqlite3.Database });
  // WAL = readers don't block on a writer and vice versa, and it's more
  // crash-resilient than the default rollback journal for our "many small
  // writes over a long-lived process" access pattern.
  await db.exec('PRAGMA journal_mode = WAL');
  await db.exec('PRAGMA foreign_keys = ON');
  await db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      title TEXT,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      extra TEXT,
      messages TEXT NOT NULL
    )
  `);
  await migrateFromLegacyJson(db);
  return db;
}

function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = openDb().catch((e) => {
      dbPromise = null; // don't cache a permanently-broken connection — allow the next call to retry
      throw e;
    });
  }
  return dbPromise;
}

function rowToChat(row: any): StoredChat {
  let extra: Record<string, any> = {};
  if (row.extra) {
    try {
      extra = JSON.parse(row.extra);
    } catch {
      /* corrupt extra blob — drop it rather than failing the whole read */
    }
  }
  let messages: any[] = [];
  try {
    const parsed = JSON.parse(row.messages);
    if (Array.isArray(parsed)) messages = parsed;
  } catch {
    /* corrupt row — surface as empty rather than throwing and taking down the whole chat list */
  }

  return {
    ...extra,
    id: row.id,
    title: row.title,
    isPinned: !!row.is_pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages,
  };
}

function chatToRow(chat: any): {
  id: string;
  title: string;
  is_pinned: number;
  created_at: number;
  updated_at: number;
  extra: string | null;
  messages: string;
} {
  const { id, title, isPinned, createdAt, updatedAt, messages, ...extra } = chat;
  return {
    id: String(id),
    title: title ?? 'New Chat',
    is_pinned: isPinned ? 1 : 0,
    created_at: Number(createdAt) || Date.now(),
    updated_at: Number(updatedAt) || Date.now(),
    extra: Object.keys(extra).length ? JSON.stringify(extra) : null,
    messages: JSON.stringify(Array.isArray(messages) ? messages : []),
  };
}

async function readChatsRaw(db: Database): Promise<StoredChat[]> {
  const rows = await db.all('SELECT id, title, is_pinned, created_at, updated_at, extra, messages FROM chats');
  return rows.map(rowToChat);
}

// Same same-process serialization pattern the rest of this app already uses
// (settings.ts, and the JSON-backed chatStore.ts this replaces) — a
// same-process mutex, not a cross-process lock. Fine here: this app only
// ever runs as a single `next dev` / `next start` process.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn);
  queue = result.then(() => undefined, () => undefined);
  return result;
}

export function readChats(): Promise<StoredChat[]> {
  return enqueue(async () => {
    const db = await getDb();
    return readChatsRaw(db);
  });
}

/**
 * Full replace of the table contents. Rarely needed in practice —
 * updateChats() is the normal path — kept only for API parity with the old
 * JSON-backed store.
 */
export function writeChats(chats: StoredChat[]): Promise<void> {
  return enqueue(async () => {
    const db = await getDb();
    await db.exec('BEGIN IMMEDIATE');
    try {
      await db.run('DELETE FROM chats');
      for (const chat of chats) {
        const r = chatToRow(chat);
        await db.run(
          'INSERT INTO chats (id, title, is_pinned, created_at, updated_at, extra, messages) VALUES (?, ?, ?, ?, ?, ?, ?)',
          r.id, r.title, r.is_pinned, r.created_at, r.updated_at, r.extra, r.messages
        );
      }
      await db.exec('COMMIT');
    } catch (e) {
      await db.exec('ROLLBACK');
      throw e;
    }
  });
}

/**
 * Read-modify-write the whole chats array under the shared queue — same
 * contract as before: `mutate` receives the current array (safe to mutate
 * chat objects in place or return a brand-new array — both patterns are
 * used by existing callers) and its return value is what gets persisted.
 *
 * Internally this only writes the rows that actually differ from what was
 * read (by id + a full-content fingerprint captured *before* mutate runs)
 * instead of rewriting every chat, and the whole batch of changes happens
 * in one transaction.
 */
export function updateChats(
  mutate: (chats: StoredChat[]) => StoredChat[] | Promise<StoredChat[]>
): Promise<StoredChat[]> {
  return enqueue(async () => {
    const db = await getDb();
    const before = await readChatsRaw(db);

    // Fingerprint BEFORE calling mutate(): mutate is allowed to (and does,
    // in agent/route.ts's saveMessagesToChat) modify these same chat
    // objects in place, so a post-mutate comparison against `before` would
    // be comparing an object against itself and never see a difference.
    const beforeFingerprints = new Map(before.map((c) => [c.id, JSON.stringify(c)]));
    const beforeIds = new Set(before.map((c) => c.id));

    const next = await mutate(before);
    const nextIds = new Set(next.map((c) => c.id));

    const toDelete = [...beforeIds].filter((id) => !nextIds.has(id));
    const toUpsert = next.filter((c) => beforeFingerprints.get(c.id) !== JSON.stringify(c));

    if (toDelete.length === 0 && toUpsert.length === 0) return next;

    await db.exec('BEGIN IMMEDIATE');
    try {
      for (const id of toDelete) {
        await db.run('DELETE FROM chats WHERE id = ?', id);
      }
      for (const chat of toUpsert) {
        const r = chatToRow(chat);
        await db.run(
          `INSERT INTO chats (id, title, is_pinned, created_at, updated_at, extra, messages)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             is_pinned = excluded.is_pinned,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             extra = excluded.extra,
             messages = excluded.messages`,
          r.id, r.title, r.is_pinned, r.created_at, r.updated_at, r.extra, r.messages
        );
      }
      await db.exec('COMMIT');
    } catch (e) {
      await db.exec('ROLLBACK');
      throw e;
    }

    return next;
  });
}

/**
 * Test-only escape hatch: forces the next call to re-open the database
 * (re-running the CREATE TABLE / migration steps) instead of reusing the
 * cached connection. Not used by any production code path.
 */
export function __resetForTests(): void {
  dbPromise = null;
}
