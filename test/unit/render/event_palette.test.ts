import { describe, it, expect } from 'vitest';
import { packEventPalette, EVENT_PALETTE_SIZE } from '@/render/params.js';
import {
  DEFAULT_RENDER_PARAMS, DEFAULT_EVENT_PALETTE, EVENT_CLASS_KEYS,
} from '@/render/types.js';
import { srgbToLinear } from '@/render/oklab.js';
import { OutcomeClass } from '@/debug/descriptor_bits.js';

describe('event palette — packer pin + enum alignment (three-place rule)', () => {
  it('packs 10 × vec4 = 160 bytes, entries in EVENT_CLASS_KEYS order', () => {
    const buf = packEventPalette(DEFAULT_RENDER_PARAMS);
    expect(buf.byteLength).toBe(EVENT_PALETTE_SIZE);
    const f32 = new Float32Array(buf);
    EVENT_CLASS_KEYS.forEach((key, i) => {
      const [r, g, b] = DEFAULT_EVENT_PALETTE[key];
      expect(f32[i * 4 + 0]).toBeCloseTo(r, 6);
      expect(f32[i * 4 + 1]).toBeCloseTo(g, 6);
      expect(f32[i * 4 + 2]).toBeCloseTo(b, 6);
      expect(f32[i * 4 + 3]).toBe(1);
    });
    // Reserved slot 9 zeroed except alpha lane untouched (whole slot zero).
    expect(f32[36]).toBe(0); expect(f32[37]).toBe(0); expect(f32[38]).toBe(0);
  });

  it('entry order mirrors the WGSL event_colour index derivation', () => {
    // event_colour: cls 0 → 0; cls 1 + detail d → 1+d; cls 2 + detail d → 4+d;
    // cls 3 → 7; default → 8. The keys must sit at exactly those indices.
    expect(EVENT_CLASS_KEYS[0]).toBe('bounded');
    expect(EVENT_CLASS_KEYS[1 + 0]).toBe('collision01');
    expect(EVENT_CLASS_KEYS[1 + 1]).toBe('collision02');
    expect(EVENT_CLASS_KEYS[1 + 2]).toBe('collision12');
    expect(EVENT_CLASS_KEYS[4 + 0]).toBe('escape0');
    expect(EVENT_CLASS_KEYS[4 + 1]).toBe('escape1');
    expect(EVENT_CLASS_KEYS[4 + 2]).toBe('escape2');
    expect(EVENT_CLASS_KEYS[7]).toBe('degenerate');
    expect(EVENT_CLASS_KEYS[8]).toBe('timeout');
    // And the class integers those branches switch on are the descriptor's
    // (sample_descriptor & 0x7) enum — the single normative ordering.
    expect(OutcomeClass.Bounded).toBe(0);
    expect(OutcomeClass.Collision).toBe(1);
    expect(OutcomeClass.Escape).toBe(2);
    expect(OutcomeClass.Degenerate).toBe(3);
    expect(OutcomeClass.Timeout).toBe(4);
  });

  it('defaults reproduce the historical main-branch GLSL classifier', () => {
    // src/shaders/principia/frag.glsl on `main`: collision pairs r/g/b,
    // escapes yellow/magenta/cyan (0.8), bounded black, invalid white.
    const l8 = srgbToLinear(0.8);
    expect(DEFAULT_EVENT_PALETTE.bounded).toEqual([0, 0, 0]);
    expect(DEFAULT_EVENT_PALETTE.collision01[0]).toBeCloseTo(1, 12);
    expect(DEFAULT_EVENT_PALETTE.collision02[1]).toBeCloseTo(1, 12);
    expect(DEFAULT_EVENT_PALETTE.collision12[2]).toBeCloseTo(1, 12);
    expect(DEFAULT_EVENT_PALETTE.escape0[0]).toBeCloseTo(l8, 12);
    expect(DEFAULT_EVENT_PALETTE.escape0[1]).toBeCloseTo(l8, 12);
    expect(DEFAULT_EVENT_PALETTE.escape0[2]).toBe(0);
    expect(DEFAULT_EVENT_PALETTE.escape1[1]).toBe(0);          // magenta
    expect(DEFAULT_EVENT_PALETTE.escape2[0]).toBe(0);          // cyan
    expect(DEFAULT_EVENT_PALETTE.degenerate).toEqual([1, 1, 1]);
  });
});
