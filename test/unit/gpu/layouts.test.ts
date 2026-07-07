import { describe, it, expect } from 'vitest';

// NB the descriptors use layouts.ts's own STAGE constants, NOT the
// GPUShaderStage global — that global only exists in a WebGPU environment,
// and this suite (like every Node import of the barrel) must not crash.
import {
  STAGE, CHART_UNIFORMS_SIZE,
  FRAME_LAYOUT_DESC, PER_TILE_LAYOUT_DESC,
  REDUCTION_LAYOUT_DESC, RENDER_LAYOUT_DESC,
} from '@/gpu/layouts.js';
import { LINEARISED_UNIFORMS_SIZE } from '@/gpu/linearised_uniforms.js';

const entries = (d: GPUBindGroupLayoutDescriptor): GPUBindGroupLayoutEntry[] =>
  [...d.entries];

describe('layout descriptors (the canonical group table)', () => {
  it('STAGE matches the WebGPU spec constants', () => {
    expect(STAGE.VERTEX).toBe(0x1);
    expect(STAGE.FRAGMENT).toBe(0x2);
    expect(STAGE.COMPUTE).toBe(0x4);
  });

  it('frame group is SimUniforms(0), TileRequest(1), Debug(2), ChartUniforms(3), LinearisedRef(4)', () => {
    const e = entries(FRAME_LAYOUT_DESC);
    expect(e.map((x) => x.binding)).toEqual([0, 1, 2, 3, 4]);
    for (const x of e) expect(x.buffer?.type ?? 'uniform').toBe('uniform');
  });

  it('frame.SimUniforms is visible to compute and fragment', () => {
    const flag = entries(FRAME_LAYOUT_DESC)[0]!.visibility;
    expect(flag & STAGE.COMPUTE).toBeTruthy();
    expect(flag & STAGE.FRAGMENT).toBeTruthy();
  });

  it('frame.Debug (binding 2, G17) is fragment-visible', () => {
    // render_layer0.wgsl statically reads DebugUniform at g0b2 (D17.1);
    // this slot is why ChartUniforms lives at binding 3, not the G3 doc's
    // original binding 2.
    const dbg = entries(FRAME_LAYOUT_DESC)[2]!;
    expect(dbg.binding).toBe(2);
    expect(dbg.visibility & STAGE.FRAGMENT).toBeTruthy();
  });

  it('frame.ChartUniforms (binding 3, G4 slot) is compute+fragment; 64-byte contract', () => {
    const chart = entries(FRAME_LAYOUT_DESC)[3]!;
    expect(chart.binding).toBe(3);
    expect(chart.visibility & STAGE.COMPUTE).toBeTruthy();
    expect(chart.visibility & STAGE.FRAGMENT).toBeTruthy();
    expect(CHART_UNIFORMS_SIZE).toBe(64);
  });

  it('frame.LinearisedRef (binding 4, G6 slot) is compute-only; 256-byte contract', () => {
    const lin = entries(FRAME_LAYOUT_DESC)[4]!;
    expect(lin.binding).toBe(4);
    expect(lin.visibility & STAGE.COMPUTE).toBeTruthy();
    expect(lin.visibility & STAGE.FRAGMENT).toBeFalsy();
    expect(LINEARISED_UNIFORMS_SIZE).toBe(256);
  });

  it('per-tile storage is read-write and visible to both compute and fragment', () => {
    for (const e of entries(PER_TILE_LAYOUT_DESC)) {
      expect(e.buffer?.type).toBe('storage');
      expect(e.visibility & STAGE.COMPUTE).toBeTruthy();
      expect(e.visibility & STAGE.FRAGMENT).toBeTruthy();
    }
  });

  it('reduction is compute-only storage', () => {
    const e0 = entries(REDUCTION_LAYOUT_DESC)[0]!;
    expect(e0.buffer?.type).toBe('storage');
    expect(e0.visibility & STAGE.FRAGMENT).toBeFalsy();
    expect(e0.visibility & STAGE.COMPUTE).toBeTruthy();
  });

  it('render group is fragment-only uniform', () => {
    const e0 = entries(RENDER_LAYOUT_DESC)[0]!;
    expect(e0.buffer?.type).toBe('uniform');
    expect(e0.visibility & STAGE.COMPUTE).toBeFalsy();
    expect(e0.visibility & STAGE.FRAGMENT).toBeTruthy();
  });

  it('every shader that binds group(1) declares read_write (access-mode match)', () => {
    // WebGPU requires the shader's access mode to MATCH the layout's buffer
    // type; the shared perTile layout is 'storage' (read-write), so no
    // linked shader may declare `var<storage, read>` on group(1).
    // Pinned here against the real shader sources.
    return import('node:fs').then(({ readFileSync, readdirSync }) => {
      const dir = new URL('../../../src/gpu/shaders/', import.meta.url);
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.wgsl')) continue;
        const src = readFileSync(new URL(f, dir), 'utf8');
        for (const line of src.split('\n')) {
          if (/@group\(1\)/.test(line) && /var<storage/.test(line)) {
            expect(line, `${f}: ${line.trim()}`).toContain('read_write');
          }
        }
      }
    });
  });
});
