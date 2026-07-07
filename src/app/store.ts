import type { ViewState } from '@/interact/view_state.js';
import { defaultViewState } from '@/interact/view_state.js';

/**
 * Minimal reactive store. Subscribers are notified on every change;
 * callers use `setView` for immutable updates. Nothing fancy — vanilla
 * TS, zero deps. The contract is `subscribe + setView + snapshot`;
 * everything on App reads or writes through this single source of truth
 * (which is what makes M12's URL-share / sidecar-reproduce path work).
 */
export type Subscriber = (v: ViewState) => void;

export class Store {
  private current: ViewState;
  private subs = new Set<Subscriber>();

  constructor(initial: ViewState = defaultViewState()) {
    this.current = initial;
  }

  snapshot(): ViewState { return this.current; }

  setView(next: ViewState): void {
    this.current = next;
    for (const cb of this.subs) cb(next);
  }

  /** Functional update. */
  update(fn: (v: ViewState) => ViewState): void {
    this.setView(fn(this.current));
  }

  subscribe(cb: Subscriber): () => void {
    this.subs.add(cb);
    cb(this.current);
    return () => { this.subs.delete(cb); };
  }
}
