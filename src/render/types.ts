export type ColourMode =
  | 'event_class'
  | 'energy'        | 'ang_momentum'  | 'kinetic'
  | 'potential'     | 'virial'
  | 'mass_ratio_12' | 'mass_ratio_13' | 'mass_fraction'
  | 'jacobi_rho1'   | 'jacobi_rho2'   | 'jacobi_ratio'
  | 'jacobi_angle'  | 'min_pair_dist'
  | 'escape_time'   | 'close_encounters' | 'min_approach'
  | 'energy_drift_abs' | 'energy_drift_rel'
  | 'lz_drift_abs'  | 'lz_drift_rel'
  | 'shape_sphere_vmf' | 'shape_sphere_okabe_ito'
  | 'stability_x_hue'
  | 'none';                         // constant mid-grey: brightness carries everything

export type BrightnessMode =
  | 'flat'                          // "none": L = 1, colour carries everything
  | 'time_to_event'
  | 'diffusion'
  | 'bc_proximity'
  | 'energy_drift'
  | 'ftle';                         // Benettin FTLE (research tier computes it)

export type CombinerMode =
  | 'replace_lightness'    // OKLAB-correct, default
  | 'modulate_lightness'
  | 'multiply_rgb';

export type CvdMode = 'none' | 'protan' | 'deutan' | 'tritan' | 'achrom';

export type PaletteId =
  | 'viridis' | 'cividis' | 'plasma' | 'magma' | 'inferno'
  | 'twilight' | 'cool_warm' | 'principia' | 'cubehelix';

/** Event-classification palette entries, in the packed uniform's order.
 *  Indices are derived from the sample_descriptor: class 0 → bounded;
 *  class 1 + detail 0/1/2 → collision pair 0-1/0-2/1-2; class 2 + detail
 *  0/1/2 → escape body 1/2/3; class 3 → degenerate; class ≥4 → timeout. */
export const EVENT_CLASS_KEYS = [
  'bounded',
  'collision01', 'collision02', 'collision12',
  'escape0', 'escape1', 'escape2',
  'degenerate', 'timeout',
] as const;
export type EventClassKey = (typeof EVENT_CLASS_KEYS)[number];
export type EventPalette = Record<EventClassKey, readonly [number, number, number]>;

// Gamma conversion lives in oklab.ts (srgbToLinear/linearToSrgb); the
// palette defaults below are stored in LINEAR sRGB because the render graph
// gamma-encodes at the very end.
const s2l = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const lin = (r: number, g: number, b: number): readonly [number, number, number] =>
  [s2l(r), s2l(g), s2l(b)];

/** Defaults reproduce the historical GLSL classifier on `main`
 *  (src/shaders/principia/frag.glsl): collision pairs red/green/blue,
 *  escapes yellow/magenta/cyan, bounded black, invalid-decode white.
 *  Timeout (a distinct terminal state here, folded into bounded on main)
 *  gets grey. Brightness-by-time-to-event is the brightness node's job in
 *  this pipeline, not baked into the hues. */
export const DEFAULT_EVENT_PALETTE: EventPalette = {
  bounded:     lin(0.0, 0.0, 0.0),
  collision01: lin(1.0, 0.0, 0.0),
  collision02: lin(0.0, 1.0, 0.0),
  collision12: lin(0.0, 0.0, 1.0),
  escape0:     lin(0.8, 0.8, 0.0),
  escape1:     lin(0.8, 0.0, 0.8),
  escape2:     lin(0.0, 0.8, 0.8),
  degenerate:  lin(1.0, 1.0, 1.0),
  timeout:     lin(0.5, 0.5, 0.5),
};

/**
 * Render parameters live in group 3; rebinding this group is the only
 * cost of changing the visualisation. Compute and reduction buffers
 * are unaffected.
 */
export interface RenderParams {
  colourMode:      ColourMode;
  brightnessMode:  BrightnessMode;
  combinerMode:    CombinerMode;
  cvdMode:         CvdMode;
  palette:         PaletteId;
  paletteRange:    [number, number];      // domain min/max for sequential modes
  vmfKappa:        number;                // 0.5 .. 12; default 3
  vmfChroma:       number;                // 0.05 .. 0.22; default 0.15
  vmfLightness:    number;                // 0.35 .. 0.90; default 0.7
  physicsOverlay:  boolean;
  overlayStrength: number;                // 0..1
  playbackTau:     number;                // simulation time for animation
  wallClockTime:   number;                // for time-varying effects
  /** Debug recolour mode (render-only; -1 = off, else DebugMode 0..5). It
   *  pre-empts the colour switch to recolour the SAME SimResult buffer, so
   *  toggling a diagnostic never recomputes — it is a group-3 rebind like
   *  every other render param. */
  debugMode:       number;
  debugHeatScale:  number;                // drift heat: t = value / heatScale
  /** Event-classification colours (render-only, linear sRGB). Packed into
   *  their own group(3) uniform (packEventPalette), not the 64-byte
   *  RenderParams buffer. */
  eventPalette:    EventPalette;
}

export const DEFAULT_RENDER_PARAMS: RenderParams = {
  colourMode:     'event_class',
  brightnessMode: 'time_to_event',
  combinerMode:   'replace_lightness',
  cvdMode:        'none',
  palette:        'viridis',
  paletteRange:   [-1, 1],
  vmfKappa:       3,
  vmfChroma:      0.15,
  vmfLightness:   0.70,
  physicsOverlay: true,
  overlayStrength: 0.6,
  playbackTau:    0,
  wallClockTime:  0,
  debugMode:      -1,          // off: production colour switch runs
  debugHeatScale: 1e-3,
  eventPalette:   DEFAULT_EVENT_PALETTE,
};
