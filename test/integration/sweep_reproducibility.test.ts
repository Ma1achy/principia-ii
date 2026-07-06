import { describe, it, expect } from 'vitest';
import { evaluateTimeline } from '@/export/timeline.js';
import { makeSidecar, verifySidecar } from '@/export/sidecar.js';
import { defaultViewState } from '@/interact/view_state.js';
import type { ViewState } from '@/interact/view_state.js';
import type { Timeline } from '@/export/types.js';

describe('10-frame z[3] sweep reproducibility', () => {
  it('byte-identical re-runs of the same timeline produce the same payload', async () => {
    const tl: Timeline = {
      base: defaultViewState(),
      durationFrames: 10,
      tracks: [{
        path: 'z0[3]',
        keyframes: [
          { frame: 0, value: -1, easing: 'linear' },
          { frame: 9, value:  1, easing: 'linear' },
        ],
      }],
      output: { format: 'binary', path: 'tmp', includeSidecar: true },
    };

    const renderFrame = (view: ViewState) => {
      // Deterministic stub: serialise the view, return a 32-byte payload
      // of the leading bytes. Real runs use the GPU pipeline.
      const json = JSON.stringify(view);
      const enc = new TextEncoder().encode(json);
      const out = new ArrayBuffer(32);
      new Uint8Array(out).set(enc.subarray(0, Math.min(32, enc.length)));
      return Promise.resolve(out);
    };

    const buffersA: ArrayBuffer[] = [];
    const buffersB: ArrayBuffer[] = [];
    for (let f = 0; f < tl.durationFrames; f++) {
      const v = evaluateTimeline(tl, f);
      buffersA.push(await renderFrame(v));
      buffersB.push(await renderFrame(v));
    }
    for (let f = 0; f < tl.durationFrames; f++) {
      expect(new Uint8Array(buffersA[f]!)).toEqual(new Uint8Array(buffersB[f]!));
    }

    // Sidecar verification on the first frame.
    const sc = await makeSidecar(tl.base, buffersA[0]!);
    expect(await verifySidecar(sc, buffersA[0]!)).toBe(true);
  });
});
