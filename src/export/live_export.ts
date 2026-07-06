/**
 * Live-simulation export: each output frame advances every pixel by one
 * macro step. The persistent state is a `float4` buffer for `n(t)` plus
 * a separate `(r, p)` buffer.
 *
 * Provided as a contract here — the actual GPU dispatch is a thin variant
 * of M3 that doesn't reset the state buffer between frames.
 */
export interface LiveExport {
  step:   () => Promise<ArrayBuffer>;       // one frame
  reset:  () => Promise<void>;
  readonly state: 'running' | 'paused' | 'finished';
}

export function makeLiveExport(): LiveExport {
  // `state` must be a getter: a plain property would freeze the value
  // captured at construction and step()/reset() mutations would be
  // invisible to callers.
  let state: LiveExport['state'] = 'paused';
  return {
    get state() { return state; },
    step()  { state = 'running'; return Promise.resolve(new ArrayBuffer(0)); },
    reset() { state = 'paused';  return Promise.resolve(); },
  };
}
