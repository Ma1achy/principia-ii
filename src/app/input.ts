import type { Store } from './store.js';
import { setSlider } from '@/interact/sliders.js';
import { applyZoomStep } from '@/interact/zoom.js';
import { setTilts } from '@/interact/tilt.js';
import { lockAffine, unlock } from '@/interact/lock.js';
import { lookup, type LookupInput } from '@/interact/lookup.js';
import { preserveLockAcrossChart } from '@/interact/preserve.js';

export interface InputOutcome {
  ok: boolean;
  reason?: string;
}

/**
 * Gesture handlers translate UI events into ViewState updates. Each one
 * is a thin wrapper around an interact/ helper — the store stays the
 * single source of truth, and rejected operations leave it untouched.
 */
export class InputHandlers {
  constructor(private store: Store) {}

  setSlider(k: number, value: number): void {
    this.store.update((v) => setSlider(v, k, value));
  }

  zoom(deltaLog2: number): void {
    this.store.update((v) => applyZoomStep(v, deltaLog2));
  }

  setTilt(opts: {
    tilt1?: number; tilt1Target?: number;
    tilt2?: number; tilt2Target?: number;
  }): void {
    this.store.update((v) => setTilts(v, opts));
  }

  lock(pixel: { s: number; t: number }): void {
    this.store.update((v) => lockAffine(v, pixel));
  }

  unlock(): void {
    this.store.update((v) => unlock(v));
  }

  lookup(input: LookupInput): InputOutcome {
    const r = lookup(input, this.store.snapshot());
    if (r.kind === 'rejected') return { ok: false, reason: r.reason };
    this.store.setView(r.view);
    return r.clamped ? { ok: true, reason: 'lookup_clamped' } : { ok: true };
  }

  switchChart(newChartType: string): InputOutcome {
    const r = preserveLockAcrossChart(this.store.snapshot(), newChartType);
    if (r.kind === 'rejected') return { ok: false, reason: r.reason };
    this.store.setView(r.view);
    return r.projected ? { ok: true, reason: 'projected' } : { ok: true };
  }
}
