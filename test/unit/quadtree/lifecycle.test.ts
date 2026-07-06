import { describe, it, expect } from 'vitest';
import { canTransition, transition } from '@/quadtree/lifecycle.js';
import type { CachedTile } from '@/quadtree/types.js';

const make = (lc: any): CachedTile => ({
  id: { z: 0, tx: 0, ty: 0 },
  simBuffer: null, icBuffer: null,
  lifecycle: lc, cacheAge: 0, lastUsed: 0, computeCostMs: 0,
});

describe('lifecycle transitions', () => {
  it('allows the canonical happy path', () => {
    const t = make('unseen');
    transition(t, 'queued');     expect(t.lifecycle).toBe('queued');
    transition(t, 'computing');  expect(t.lifecycle).toBe('computing');
    transition(t, 'ready');      expect(t.lifecycle).toBe('ready');
    transition(t, 'readyRefinable');
    transition(t, 'computing');  expect(t.lifecycle).toBe('computing');
  });

  it('rejects ready → queued (no skipping computing)', () => {
    const t = make('ready');
    expect(canTransition('ready', 'queued')).toBe(false);
    expect(() => transition(t, 'queued')).toThrow();
  });

  it('allows cancellation from queued and ready', () => {
    expect(canTransition('queued', 'unseen')).toBe(true);
    expect(canTransition('ready',  'unseen')).toBe(true);
    expect(canTransition('computing', 'unseen')).toBe(true);
  });
});
