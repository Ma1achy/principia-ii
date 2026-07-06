import { describe, it, expect } from 'vitest';
import { encodeViewStateUrl, decodeViewStateUrl } from '@/export/url.js';
import { defaultViewState } from '@/interact/view_state.js';
import type { Vec8 } from '@/math/types.js';

describe('URL encode / decode', () => {
  it('round-trips defaultViewState', () => {
    const v0 = defaultViewState();
    const enc = encodeViewStateUrl(v0);
    const v1 = decodeViewStateUrl(enc);
    expect(v1).toEqual(v0);
  });

  it('round-trips a non-default view', () => {
    const v0 = { ...defaultViewState(),
                 z0: [0.1, -0.2, 0, 0, 0.5, 0, 0, 0] as Vec8,
                 zoom: 3, qualityTier: 'research' as const };
    expect(decodeViewStateUrl(encodeViewStateUrl(v0))).toEqual(v0);
  });

  it('produces URL-safe characters only', () => {
    const v0 = defaultViewState();
    const enc = encodeViewStateUrl(v0);
    expect(/^[A-Za-z0-9_-]+$/.test(enc)).toBe(true);
  });
});
