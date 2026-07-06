/**
 * Debug render modes. Each mode is a recolouring of the same SimResult buffer;
 * the active mode rides in a tiny DebugUniform (group(0) binding(2)) consumed by
 * the extended render_layer0.wgsl fs_main. The colour math lives in WGSL for the
 * live page; the TS LUTs/labels below drive the dev-page legend and the unit
 * test that asserts the enum ↔ label ↔ swatch mapping is total.
 */

export enum DebugMode {
  Outcome = 0,                // M3 default: colour by outcome class (byte-for-byte M3)
  Detail = 1,                 // colour by detail bits (descriptor bits 3..4)
  FtleValid = 2,              // green = FTLE_VALID (bit 7), grey = not
  Suspect = 3,                // suspect = suspectEnergy (bit 5) OR suspectLz (bit 6)
  EnergyDriftHeat = 4,        // heatmap of SimResult.delta_E_max_abs (normalised)
  CheckpointCompleteness = 5, // fraction of non-zero checkpoints / M
}

export interface DebugModeInfo {
  mode: DebugMode;
  label: string;
  /** Legend swatch (sRGB 0..1), representative of the mode's "on"/max colour. */
  swatch: readonly [number, number, number];
  continuous: boolean;  // heatmap (true) vs categorical (false)
}

export const DEBUG_MODES: readonly DebugModeInfo[] = [
  { mode: DebugMode.Outcome,                label: 'Outcome class',           swatch: [0.7, 0.7, 0.2], continuous: false },
  { mode: DebugMode.Detail,                 label: 'Detail bits',             swatch: [0.8, 0.4, 0.8], continuous: false },
  { mode: DebugMode.FtleValid,              label: 'FTLE_VALID',              swatch: [0.2, 0.9, 0.3], continuous: false },
  { mode: DebugMode.Suspect,                label: 'Suspect (E or Lz)',       swatch: [0.9, 0.2, 0.2], continuous: false },
  { mode: DebugMode.EnergyDriftHeat,        label: 'Energy-drift heatmap',    swatch: [1.0, 0.5, 0.0], continuous: true  },
  { mode: DebugMode.CheckpointCompleteness, label: 'Checkpoint completeness', swatch: [0.9, 0.9, 0.9], continuous: true  },
];

/** Total label lookup (never throws; reserved values fall through to a stub). */
export function debugModeLabel(mode: number): string {
  return DEBUG_MODES.find((m) => m.mode === mode)?.label ?? `MODE${mode}`;
}

/**
 * Pack the DebugUniform: 16 bytes (vec4 alignment).
 *   f32[0]=mode (as float for cheap WGSL compare), f32[1]=heatScale,
 *   u32[2]=checkpointCount, f32[3]=pad.
 * heatScale maps a drift value into [0,1] in the shader (value/heatScale).
 */
export function packDebugUniform(
  mode: DebugMode, heatScale: number, checkpointCount: number,
): ArrayBuffer {
  const buf = new ArrayBuffer(16);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  f32[0] = mode;
  f32[1] = heatScale > 0 ? heatScale : 1;
  u32[2] = checkpointCount >>> 0;
  f32[3] = 0;
  return buf;
}
