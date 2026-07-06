import { describe, it, expect } from 'vitest';
import {
  evaluateTrack, evaluateTimeline, getByPath, setByPath,
} from '@/export/timeline.js';
import type { Timeline, TimelineTrack } from '@/export/types.js';
import { defaultViewState } from '@/interact/view_state.js';

describe('path get / set', () => {
  it('getByPath supports array indices', () => {
    const o = { a: { b: [{ c: 7 }, { c: 9 }] } };
    expect(getByPath(o, 'a.b[1].c')).toBe(9);
  });
  it('setByPath does not mutate the original at non-target nodes', () => {
    const o = { a: { b: [1, 2, 3] } };
    const o2 = structuredClone(o);
    setByPath(o2, 'a.b[1]', 99);
    expect(o.a.b[1]).toBe(2);
    expect(o2.a.b[1]).toBe(99);
  });
});

describe('evaluateTrack', () => {
  const tr: TimelineTrack<number> = {
    path: 'zoom',
    keyframes: [
      { frame: 0,  value: 0,  easing: 'linear' },
      { frame: 10, value: 10, easing: 'linear' },
    ],
  };
  it('returns base before the first keyframe', () => {
    expect(evaluateTrack(tr, -3, -1)).toBe(-1);
  });
  it('linearly interpolates inside the bracket', () => {
    expect(evaluateTrack(tr, 5, 0)).toBe(5);
  });
  it('clamps to last keyframe past the end', () => {
    expect(evaluateTrack(tr, 100, 0)).toBe(10);
  });
});

describe('evaluateTimeline', () => {
  const tl: Timeline = {
    base: defaultViewState(),
    durationFrames: 10,
    tracks: [
      { path: 'z0[3]',
        keyframes: [
          { frame: 0,  value: -1, easing: 'linear' },
          { frame: 9,  value:  1, easing: 'linear' },
        ] },
      { path: 'zoom',
        keyframes: [
          { frame: 5,  value: 2, easing: 'step' },
        ] },
    ],
    output: { format: 'png', path: 'out', includeSidecar: true },
  };

  it('first frame is at the keyframe-zero values', () => {
    const v = evaluateTimeline(tl, 0);
    expect(v.z0[3]).toBe(-1);
  });

  it('mid-frame interpolates the numeric track', () => {
    const v = evaluateTimeline(tl, 5);
    expect(v.z0[3]).toBeCloseTo(-1 + (5 / 9) * 2, 12);   // f=5 ⇒ t = 5/9
  });

  it('single-keyframe track snaps once its frame is reached', () => {
    expect(evaluateTimeline(tl, 4).zoom).toBe(defaultViewState().zoom);
    expect(evaluateTimeline(tl, 5).zoom).toBe(2);
  });
});
