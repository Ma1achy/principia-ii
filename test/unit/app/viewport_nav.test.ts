import { describe, it, expect } from 'vitest';
import { panViewport, zoomViewport } from '@/app/viewport_nav.js';
import { defaultViewState } from '@/interact/view_state.js';

describe('viewport navigation (G8)', () => {
  it('pan moves the centre and clamps the window inside [0,1]²', () => {
    const v = { ...defaultViewState(), uvCentre: [0.5, 0.5] as [number, number],
                uvHalfWidth: [0.25, 0.25] as [number, number] };
    const p = panViewport(v, 0.1, -0.05);
    expect(p.uvCentre[0]).toBeCloseTo(0.6, 12);
    expect(p.uvCentre[1]).toBeCloseTo(0.45, 12);
    // Pan far right: clamps so the window never leaves the domain.
    const edge = panViewport(v, 10, 0);
    expect(edge.uvCentre[0]).toBeCloseTo(0.75, 12);
    expect(edge.uvCentre[0] + edge.uvHalfWidth[0]).toBeLessThanOrEqual(1);
  });

  it('zoom about a focus keeps the focused world point fixed on screen', () => {
    const v = { ...defaultViewState(), uvCentre: [0.5, 0.5] as [number, number],
                uvHalfWidth: [0.25, 0.25] as [number, number] };
    const focus: [number, number] = [0.25, 0.75];   // screen UV
    const worldBefore = [
      v.uvCentre[0] + (2 * focus[0] - 1) * v.uvHalfWidth[0],
      v.uvCentre[1] + (2 * focus[1] - 1) * v.uvHalfWidth[1],
    ];
    const z = zoomViewport(v, 0.5, focus);
    const worldAfter = [
      z.uvCentre[0] + (2 * focus[0] - 1) * z.uvHalfWidth[0],
      z.uvCentre[1] + (2 * focus[1] - 1) * z.uvHalfWidth[1],
    ];
    expect(worldAfter[0]).toBeCloseTo(worldBefore[0]!, 12);
    expect(worldAfter[1]).toBeCloseTo(worldBefore[1]!, 12);
    expect(z.uvHalfWidth[0]).toBeCloseTo(0.125, 12);
  });

  it('zoom out clamps at the whole domain; zoom in never hits zero', () => {
    const v = defaultViewState();
    const out = zoomViewport(v, 1e9);
    expect(out.uvHalfWidth[0]).toBe(0.5);
    expect(out.uvCentre[0]).toBe(0.5);
    let z = v;
    for (let i = 0; i < 200; i++) z = zoomViewport(z, 0.5);
    expect(z.uvHalfWidth[0]).toBeGreaterThan(0);
  });

  it('viewport moves never touch the compute cache key fields', () => {
    const v = defaultViewState();
    const moved = zoomViewport(panViewport(v, 0.2, 0.1), 0.5);
    expect(moved.mag).toBe(v.mag);
    expect(moved.z0).toEqual(v.z0);
    expect(moved.chartType).toBe(v.chartType);
  });
});
