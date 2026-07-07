import { type RenderParams, DEFAULT_RENDER_PARAMS } from '@/render/types.js';

export type RenderSubscriber = (p: RenderParams) => void;

/**
 * Reactive RenderParams store. Same contract as G2's Store so the same
 * bind()/bindInput() work, but a DISTINCT instance: changes here are
 * render-only (M7 group-3 rebind via the dispatcher's setRenderParams) and
 * MUST NOT touch ViewState, the cache, or the undo history. This is the
 * structural enforcement of the two-stage decoupling at the UI layer.
 */
export class RenderParamsStore {
  private current: RenderParams;
  private subs = new Set<RenderSubscriber>();

  constructor(
    initial: RenderParams = DEFAULT_RENDER_PARAMS,
    /** Called after every change so the caller can rebind group 3 +
     *  re-render (packing happens there — M7's 64-byte contract). */
    private readonly onRebind?: (params: RenderParams) => void,
  ) {
    this.current = initial;
  }

  snapshot(): RenderParams { return this.current; }

  setParams(next: RenderParams): void {
    this.current = next;
    for (const cb of this.subs) cb(next);
    this.onRebind?.(next);     // render-only: rebind group 3, re-render
  }

  update(fn: (p: RenderParams) => RenderParams): void {
    this.setParams(fn(this.current));
  }

  subscribe(cb: RenderSubscriber): () => void {
    this.subs.add(cb);
    cb(this.current);
    return () => { this.subs.delete(cb); };
  }
}
