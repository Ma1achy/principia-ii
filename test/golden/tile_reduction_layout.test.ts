import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  decodeTileReduction, wgslTileReductionStruct,
  sizeOfTileReduction, TILE_REDUCTION_SCHEMA_VERSION,
} from '@/gpu/structs.js';

const M = 8;
const SIZE = 272;

/**
 * Hand-pinned lane offsets (ADR 0006 golden). This list is a DELIBERATE
 * second copy of the field order in TILE_REDUCTION_FIELDS: any reordering,
 * insertion, or retyping of the table shifts a sentinel into the wrong
 * field here and fails loudly — the constant-size drift the 272-byte size
 * pin cannot see. Head: id 3×i32 (lanes 0..2), level i32 (lane 3),
 * mean_n_checkpoints 8×vec4 (lanes 4..35), scalars from lane 36.
 */
const PINNED_LANES: readonly [string, 'f32' | 'u32' | 'i32'][] = [
  ['mean_arc_length_n', 'f32'],          // lane 36
  ['mean_t_end', 'f32'],
  ['mean_d_min', 'f32'],
  ['mean_ftle', 'f32'],
  ['mean_energy_drift', 'f32'],
  ['mean_diffusion', 'f32'],
  ['spread_n', 'f32'],
  ['spread_arc_length_n', 'f32'],
  ['spread_t_end', 'f32'],
  ['spread_d_min', 'f32'],
  ['spread_ftle', 'f32'],
  ['spread_energy_drift', 'f32'],
  ['spread_diffusion', 'f32'],
  ['outcome_impurity', 'f32'],
  ['dominant_outcome', 'u32'],
  ['suspect_fraction', 'f32'],
  ['suspect_lz_fraction', 'f32'],
  ['energy_drift_worst', 'f32'],
  ['lz_drift_worst', 'f32'],
  ['mean_word_length', 'f32'],
  ['spread_word_length', 'f32'],
  ['word_agreement', 'f32'],
  ['dominant_word_hash', 'u32'],
  ['ensemble_outcome_agreement', 'f32'],
  ['ensemble_count', 'i32'],
  ['mean_orbit_count', 'f32'],
  ['retrograde_fraction', 'f32'],
  ['coherence_score', 'f32'],
  ['priority_score', 'f32'],
  ['sample_count', 'i32'],
  ['status_flags', 'u32'],               // lane 66 (byte 264)
];

const BASE_LANE = 4 + M * 4;             // 36

/** Build a golden buffer: sentinel = 100 + field index per scalar field. */
function goldenBuffer(versionBits: number): ArrayBuffer {
  const ab = new ArrayBuffer(SIZE);
  const f32 = new Float32Array(ab);
  const i32 = new Int32Array(ab);
  const u32 = new Uint32Array(ab);
  i32[0] = 3; i32[1] = 5; i32[2] = 7;    // id
  i32[3] = 3;                             // level
  for (let m = 0; m < M; m++) {           // checkpoints: (m, m+0.25, m+0.5, m+0.75)
    const o = 4 + m * 4;
    f32[o] = m; f32[o + 1] = m + 0.25; f32[o + 2] = m + 0.5; f32[o + 3] = m + 0.75;
  }
  PINNED_LANES.forEach(([name, type], i) => {
    const lane = BASE_LANE + i;
    if (name === 'status_flags') {
      u32[lane] = versionBits | 0x2a;    // flags 0b101010 in bits 0-5
    } else if (type === 'f32') {
      f32[lane] = 100 + i;
    } else if (type === 'u32') {
      u32[lane] = 100 + i;
    } else {
      i32[lane] = 100 + i;
    }
  });
  return ab;
}

describe('TileReduction layout golden (ADR 0006)', () => {
  it('is 272 bytes at M=8 and the last pinned lane fits', () => {
    expect(sizeOfTileReduction(M)).toBe(SIZE);
    expect((BASE_LANE + PINNED_LANES.length) * 4).toBeLessThanOrEqual(SIZE);
  });

  it('round-trips every field against the hand-pinned sentinel offsets', () => {
    const r = decodeTileReduction(
      goldenBuffer(TILE_REDUCTION_SCHEMA_VERSION << 6), M);
    expect(r.id).toEqual({ z: 3, tx: 5, ty: 7 });
    expect(r.level).toBe(3);
    expect(r.mean_n_checkpoints[2]).toEqual({ x: 2, y: 2.25, z: 2.5, w: 2.75 });
    PINNED_LANES.forEach(([name], i) => {
      if (name === 'status_flags') return;   // checked separately below
      expect((r as unknown as Record<string, number>)[name],
             `field ${name} (lane ${BASE_LANE + i})`).toBe(100 + i);
    });
    // Version bits stripped; TILE_STATUS flags in bits 0-5 survive.
    expect(r.status_flags).toBe(0x2a);
  });

  it('throws on a schema-version mismatch', () => {
    const stale = goldenBuffer((TILE_REDUCTION_SCHEMA_VERSION + 1) << 6);
    expect(() => decodeTileReduction(stale, M)).toThrow(/schema mismatch/);
  });

  it('reduce.wgsl contains exactly the table-emitted struct text', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const wgsl = readFileSync(
      path.join(here, '../../src/gpu/shaders/reduce.wgsl'), 'utf-8');
    expect(wgsl).toContain(wgslTileReductionStruct(M));
    // And the WGSL writes the same version the decoder asserts.
    expect(wgsl).toContain(
      `const TILE_REDUCTION_SCHEMA_VERSION: u32 = ${TILE_REDUCTION_SCHEMA_VERSION}u;`);
  });
});
