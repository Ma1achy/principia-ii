import { describe, it, expect } from 'vitest';
import {
  LINEARISED_DECODER_DEPTH, shouldLineariseAtDepth,
} from '@/quadtree/decode_mode.js';

describe('decode-mode switchover (G6)', () => {
  it('switches to the linearised path at the spec depth threshold', () => {
    expect(LINEARISED_DECODER_DEPTH).toBe(20);
    expect(shouldLineariseAtDepth(19)).toBe(false);
    expect(shouldLineariseAtDepth(20)).toBe(true);
    expect(shouldLineariseAtDepth(30)).toBe(true);
    expect(shouldLineariseAtDepth(0)).toBe(false);
  });

  it('AT_F32_FLOOR overrides the threshold at shallow depth', () => {
    expect(shouldLineariseAtDepth(5, true)).toBe(true);
    expect(shouldLineariseAtDepth(5, false)).toBe(false);
  });
});
