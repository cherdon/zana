import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useData, useUi } from '../store.js';
import type { Project, TerminalSession, Result } from '@zana-ai/zcc-domain/product';

/**
 * A manual rename (titleLocked) or one-shot auto-name (autoTitledBy{Llm,Osc})
 * must survive restartTerminal and the close/reopenLastClosed round-trip —
 * both rebuild a fresh TerminalSession via createTerminal, which starts every
 * guard flag unset. Regression coverage for the rename-reverts-after-restart/
 * reopen bug: reconnectRemote already carried these flags through; restart
 * and reopen did not.
 */

const project: Project = {
  id: 'p1',
  name: 'proj',
  path: '/work/p1'
} as Project;

function session(id: string, over: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id,
    projectId: 'p1',
    title: `Agent ${id}`,
    profile: 'claude',
    cwd: '/work/p1',
    status: 'running',
    createdAt: 1,
    ...over
  } as TerminalSession;
}

const close = vi.fn((_id: string) => Promise.resolve(true));
const create = vi.fn(
  (_input: unknown): Promise<Result<TerminalSession>> =>
    Promise.resolve({ ok: true, value: session('fresh-id') })
);

vi.mock('../lib/product-client.js', () => ({
  product: {
    terminals: {
      close: (...args: unknown[]) => close(...(args as [string])),
      create: (...args: unknown[]) => create(...(args as [unknown]))
    },
    git: { status: vi.fn().mockRejectedValue(new Error('no git')) }
  }
}));

beforeEach(() => {
  close.mockReset();
  create.mockReset();
  close.mockResolvedValue(true);
  create.mockResolvedValue({ ok: true, value: session('fresh-id') });
  useData.setState({ projects: [project], terminals: {}, closedTabs: {}, detachedStack: {} });
  useUi.setState({ toasts: [], unread: {}, splitSlots: {} } as never);
});

describe('useData.restartTerminal rename-guard persistence', () => {
  it('carries titleLocked through to the restarted session', async () => {
    const renamed = session('renamed', { titleLocked: true, title: 'My Rename' });
    useData.setState({ terminals: { p1: [renamed] } });

    const restarted = await useData.getState().restartTerminal('renamed', 'p1');

    expect(restarted?.id).toBe('fresh-id');
    const restored = useData.getState().terminals['p1'].find((t) => t.id === 'fresh-id');
    expect(restored?.titleLocked).toBe(true);
  });

  it('carries autoTitledByOsc/autoTitledByLlm through to the restarted session', async () => {
    const autoTitled = session('auto', { autoTitledByOsc: true, autoTitledByLlm: true });
    useData.setState({ terminals: { p1: [autoTitled] } });

    await useData.getState().restartTerminal('auto', 'p1');

    const restored = useData.getState().terminals['p1'].find((t) => t.id === 'fresh-id');
    expect(restored?.autoTitledByOsc).toBe(true);
    expect(restored?.autoTitledByLlm).toBe(true);
  });

  it('does not set the guard flags when the source session never had them', async () => {
    const plain = session('plain');
    useData.setState({ terminals: { p1: [plain] } });

    await useData.getState().restartTerminal('plain', 'p1');

    const restored = useData.getState().terminals['p1'].find((t) => t.id === 'fresh-id');
    expect(restored?.titleLocked).toBeFalsy();
    expect(restored?.autoTitledByLlm).toBeFalsy();
    expect(restored?.autoTitledByOsc).toBeFalsy();
  });
});

describe('useData.closeTerminal / reopenLastClosed rename-guard persistence', () => {
  it('round-trips titleLocked through a close followed by reopen', async () => {
    const renamed = session('renamed', { titleLocked: true, title: 'My Rename' });
    useData.setState({ terminals: { p1: [renamed] } });

    await useData.getState().closeTerminal('renamed', 'p1');
    expect(useData.getState().terminals['p1']).toHaveLength(0);
    expect(useData.getState().closedTabs['p1']?.[0]?.titleLocked).toBe(true);

    const reopened = await useData.getState().reopenLastClosed('p1');

    expect(reopened?.id).toBe('fresh-id');
    const restored = useData.getState().terminals['p1'].find((t) => t.id === 'fresh-id');
    expect(restored?.titleLocked).toBe(true);
  });

  it('round-trips autoTitledByLlm/autoTitledByOsc through a close followed by reopen', async () => {
    const autoTitled = session('auto', { autoTitledByLlm: true, autoTitledByOsc: true });
    useData.setState({ terminals: { p1: [autoTitled] } });

    await useData.getState().closeTerminal('auto', 'p1');
    await useData.getState().reopenLastClosed('p1');

    const restored = useData.getState().terminals['p1'].find((t) => t.id === 'fresh-id');
    expect(restored?.autoTitledByLlm).toBe(true);
    expect(restored?.autoTitledByOsc).toBe(true);
  });

  it('leaves guard flags unset when the closed tab never had them', async () => {
    const plain = session('plain');
    useData.setState({ terminals: { p1: [plain] } });

    await useData.getState().closeTerminal('plain', 'p1');
    await useData.getState().reopenLastClosed('p1');

    const restored = useData.getState().terminals['p1'].find((t) => t.id === 'fresh-id');
    expect(restored?.titleLocked).toBeFalsy();
    expect(restored?.autoTitledByLlm).toBeFalsy();
    expect(restored?.autoTitledByOsc).toBeFalsy();
  });
});
