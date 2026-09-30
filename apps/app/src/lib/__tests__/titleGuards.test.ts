import { describe, it, expect, beforeEach } from 'vitest';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';
import { readTitleGuards, writeTitleGuards, syncTitleGuards, applyTitleGuards } from '../sessionRestore.js';

/**
 * A plain renderer reload (Cmd+R) re-hydrates live sessions straight from
 * main, which never carries titleLocked/autoTitledBy{Llm,Osc} or a rename
 * (renderer-only fields — see sessionRestore.ts). These id-keyed helpers are
 * what let the store re-apply a rename after that reload; this pins their
 * round-trip + pruning behavior in isolation from the store.
 */

// Minimal in-memory localStorage stub (the test runs in node, no jsdom).
function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; }
  } as Storage;
}

function session(id: string, over: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id,
    projectId: 'p1',
    title: `Agent ${id}`,
    profile: 'claude',
    cwd: '/work/p1',
    status: 'running',
    createdAt: 0,
    ...over
  } as TerminalSession;
}

beforeEach(() => {
  installLocalStorage();
});

describe('syncTitleGuards / readTitleGuards', () => {
  it('round-trips an upserted guard', () => {
    syncTitleGuards(['a'], { id: 'a', entry: { title: 'My Rename', titleLocked: true } });
    expect(readTitleGuards()).toEqual({ a: { title: 'My Rename', titleLocked: true } });
  });

  it('drops entries for ids no longer in the live set', () => {
    writeTitleGuards({
      dead: { title: 'Gone', titleLocked: true },
      alive: { title: 'Still here', titleLocked: true }
    });

    syncTitleGuards(['alive']);

    expect(readTitleGuards()).toEqual({ alive: { title: 'Still here', titleLocked: true } });
  });

  it('re-keys a guard onto a freshly-minted id (restart/reopen/reconnect) while retiring the old one', () => {
    writeTitleGuards({ old: { title: 'My Rename', titleLocked: true } });

    // old id is no longer live; fresh-id replaces it in the same call.
    syncTitleGuards(['fresh-id'], { id: 'fresh-id', entry: { title: 'My Rename', titleLocked: true } });

    expect(readTitleGuards()).toEqual({ 'fresh-id': { title: 'My Rename', titleLocked: true } });
  });
});

describe('applyTitleGuards', () => {
  it('re-applies a persisted rename onto a hydrated session with none of it', () => {
    const guards = readTitleGuards();
    writeTitleGuards({ a: { title: 'My Rename', titleLocked: true } });
    const hydrated = [session('a', { title: 'claude' })]; // main's stale, pre-rename title
    const patched = applyTitleGuards(hydrated, readTitleGuards());
    expect(patched[0].title).toBe('My Rename');
    expect(patched[0].titleLocked).toBe(true);
    // guards var unused beyond documenting the pre-write state
    expect(guards).toEqual({});
  });

  it('passes a session through unchanged when it has no persisted guard', () => {
    const hydrated = [session('untouched')];
    const patched = applyTitleGuards(hydrated, {});
    expect(patched).toEqual(hydrated);
  });

  it('preserves an existing true flag on the session even if the guard omits it', () => {
    const hydrated = [session('a', { autoTitledByLlm: true })];
    const patched = applyTitleGuards(hydrated, { a: { title: 'My Rename', titleLocked: true } });
    expect(patched[0].autoTitledByLlm).toBe(true);
    expect(patched[0].titleLocked).toBe(true);
  });
});
