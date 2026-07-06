/**
 * TS↔WGSL field-offset table for the M3 GPU structs. Complements (does not
 * replace) the layer0_struct_alignment pin test: that test pins *sizes*; this
 * dumps *per-field byte offsets* so a layout drift is readable at a glance
 * during bring-up. Offsets are derived from src/gpu/structs.ts packers and the
 * WGSL struct field order in simulate.wgsl, under std140-ish WGSL rules
 * (vec4 → 16B align, f32/u32 → 4B).
 */
import { sizeOfSimResult, M_DEFAULT } from '@/gpu/structs.js';

export interface FieldOffset {
  name: string;
  offset: number;       // byte offset
  size: number;         // byte size
  wgslType: string;
}

export interface StructLayout {
  struct: string;
  totalSize: number;
  fields: readonly FieldOffset[];
}

/** SimUniforms layout — mirrors packSimUniforms (96 bytes). */
export function simUniformsLayout(): StructLayout {
  const f = (name: string, offset: number, wgslType: string, size = 4): FieldOffset =>
    ({ name, offset, size, wgslType });
  return {
    struct: 'SimUniforms',
    totalSize: 96,
    fields: [
      f('m', 0, 'vec3<f32>', 12),
      f('M_total', 12, 'f32'),
      f('G', 16, 'f32'),          f('dt_macro', 20, 'f32'),
      f('N_max', 24, 'u32'),      f('r_sub', 28, 'f32'),
      f('gamma_sub', 32, 'f32'),  f('T_horizon', 36, 'f32'),
      f('r_coll', 40, 'f32'),     f('R_esc', 44, 'f32'),
      f('k_esc', 48, 'u32'),      f('eps_E', 52, 'f32'),
      f('eps_L', 56, 'f32'),      f('r_close', 60, 'f32'),
      f('quality_tier', 64, 'u32'),
      f('checkpoint_count', 68, 'u32'),
      f('samples_per_axis', 72, 'u32'),
      f('mu_max', 76, 'f32'),     f('alpha_min', 80, 'f32'),
      f('q_max', 84, 'f32'),
      // f32[22..23] (offsets 88, 92) are trailing pad to 96.
    ],
  };
}

/**
 * SimResult layout at the given M. Field order/offsets mirror the decode in
 * readback.ts decodeBuffer: M vec4 checkpoints, one vec4<u32> free-group word,
 * then 11 f32 metrics, then two u32 (descriptor, trajectory_stats), padded to
 * sizeOfSimResult(M).
 */
export function simResultLayout(M: number = M_DEFAULT): StructLayout {
  const fields: FieldOffset[] = [];
  for (let m = 0; m < M; m++) {
    fields.push({ name: `n_checkpoints[${m}]`, offset: m * 16, size: 16, wgslType: 'vec4<f32>' });
  }
  let off = M * 16;
  fields.push({ name: 'free_group_word', offset: off, size: 16, wgslType: 'vec4<u32>' });
  off += 16;
  const f32Fields = [
    'arc_length_n', 't_end', 'd_min', 'ftle', 'energy_drift', 'diffusion',
    'delta_E_max_abs', 'Lz_drift', 'delta_Lz_max_abs', 'E_0', 'Lz_0',
  ];
  for (const name of f32Fields) {
    fields.push({ name, offset: off, size: 4, wgslType: 'f32' });
    off += 4;
  }
  fields.push({ name: 'sample_descriptor', offset: off, size: 4, wgslType: 'u32' }); off += 4;
  fields.push({ name: 'trajectory_stats', offset: off, size: 4, wgslType: 'u32' }); off += 4;
  return { struct: `SimResult(M=${M})`, totalSize: sizeOfSimResult(M), fields };
}

/** Render a layout as a fixed-width text table (for console / dev page). */
export function formatLayout(layout: StructLayout): string {
  const head = `${layout.struct}  (${layout.totalSize} bytes)`;
  const rows = layout.fields.map(
    (x) => `  ${String(x.offset).padStart(4)}  ${x.wgslType.padEnd(10)} ${x.name}` +
           `  (${x.size}B)`,
  );
  return [head, ...rows].join('\n');
}

/** Dump both M3 structs to a sink (defaults to console.log). */
export function dumpStructLayouts(M = M_DEFAULT, sink: (s: string) => void = console.log): void {
  sink(formatLayout(simUniformsLayout()));
  sink(formatLayout(simResultLayout(M)));
}
