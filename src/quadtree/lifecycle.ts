import type { CachedTile, Lifecycle } from './types.js';

/**
 * Allowed transitions. Anything not listed is a bug.
 *
 *   unseen        → queued
 *   queued        → computing | unseen (cancel)
 *   computing     → ready | unseen (failure with no recovery)
 *   ready         → readyRefinable | unseen (eviction)
 *   readyRefinable → computing (split / re-dispatch) | unseen
 */
const TRANSITIONS: Record<Lifecycle, readonly Lifecycle[]> = {
  unseen:         ['queued'],
  queued:         ['computing', 'unseen'],
  computing:      ['ready',     'unseen'],
  ready:          ['readyRefinable', 'unseen'],
  readyRefinable: ['computing', 'unseen'],
};

export function canTransition(from: Lifecycle, to: Lifecycle): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transition(tile: CachedTile, to: Lifecycle): void {
  if (!canTransition(tile.lifecycle, to)) {
    throw new Error(`illegal lifecycle ${tile.lifecycle} → ${to}`);
  }
  tile.lifecycle = to;
}
