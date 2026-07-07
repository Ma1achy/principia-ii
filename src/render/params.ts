import type { RenderParams } from './types.js';

const COLOUR_MODE_INDEX: Record<RenderParams['colourMode'], number> = {
  event_class: 0, energy: 1, ang_momentum: 2, kinetic: 3,
  potential: 4, virial: 5, mass_ratio_12: 6, mass_ratio_13: 7,
  mass_fraction: 8, jacobi_rho1: 9, jacobi_rho2: 10, jacobi_ratio: 11,
  jacobi_angle: 12, min_pair_dist: 13, escape_time: 14,
  close_encounters: 15, min_approach: 16, energy_drift_abs: 17,
  energy_drift_rel: 18, lz_drift_abs: 19, lz_drift_rel: 20,
  shape_sphere_vmf: 21, shape_sphere_okabe_ito: 22, stability_x_hue: 23,
};

const BRIGHT_MODE_INDEX: Record<RenderParams['brightnessMode'], number> = {
  flat: 0, time_to_event: 1, diffusion: 2,
  bc_proximity: 3, energy_drift: 4,
};

const COMBINER_INDEX: Record<RenderParams['combinerMode'], number> = {
  replace_lightness: 0, modulate_lightness: 1, multiply_rgb: 2,
};

const CVD_INDEX: Record<RenderParams['cvdMode'], number> = {
  none: 0, protan: 1, deutan: 2, tritan: 3, achrom: 4,
};

const PALETTE_INDEX: Record<RenderParams['palette'], number> = {
  viridis: 0, cividis: 1, plasma: 2, magma: 3, inferno: 4,
  twilight: 5, cool_warm: 6, principia: 7, cubehelix: 8,
};

/**
 * Pack RenderParams into a 64-byte uniform buffer for group(3) binding(0).
 *
 * Layout (three-place rule: this packer + the RenderParams WGSL struct in
 * render_graph.wgsl + the pin in render_graph_palette_swap.test.ts change
 * together):
 *   [0..3]    colour_mode_id (u32)
 *   [4..7]    brightness_mode_id (u32)
 *   [8..11]   combiner_id (u32)
 *   [12..15]  cvd_id (u32)
 *   [16..19]  palette_id (u32)
 *   [20..23]  physics_overlay (u32)
 *   [24..27]  overlay_strength (f32)
 *   [28..31]  vmf_kappa (f32)
 *   [32..35]  vmf_chroma (f32)
 *   [36..39]  vmf_lightness (f32)
 *   [40..43]  palette_range_min (f32)
 *   [44..47]  palette_range_max (f32)
 *   [48..51]  playback_tau (f32)
 *   [52..55]  wall_clock (f32)
 *   [56..59]  debug_mode (i32; -1 = off)
 *   [60..63]  debug_heat_scale (f32)
 */
export function packRenderParams(p: RenderParams): ArrayBuffer {
  const buf = new ArrayBuffer(64);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  const i32 = new Int32Array(buf);
  u32[0] = COLOUR_MODE_INDEX[p.colourMode];
  u32[1] = BRIGHT_MODE_INDEX[p.brightnessMode];
  u32[2] = COMBINER_INDEX[p.combinerMode];
  u32[3] = CVD_INDEX[p.cvdMode];
  u32[4] = PALETTE_INDEX[p.palette];
  u32[5] = p.physicsOverlay ? 1 : 0;
  f32[6] = p.overlayStrength;
  f32[7] = p.vmfKappa;
  f32[8] = p.vmfChroma;
  f32[9] = p.vmfLightness;
  f32[10] = p.paletteRange[0];
  f32[11] = p.paletteRange[1];
  f32[12] = p.playbackTau;
  f32[13] = p.wallClockTime;
  i32[14] = p.debugMode;          // bytes [56..59]; -1 = debug off
  f32[15] = p.debugHeatScale;     // bytes [60..63]
  return buf;
}
