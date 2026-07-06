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
  | 'stability_x_hue';

export type BrightnessMode =
  | 'flat'
  | 'time_to_event'
  | 'diffusion'
  | 'bc_proximity'
  | 'energy_drift';

export type CombinerMode =
  | 'replace_lightness'    // OKLAB-correct, default
  | 'modulate_lightness'
  | 'multiply_rgb';

export type CvdMode = 'none' | 'protan' | 'deutan' | 'tritan' | 'achrom';

export type PaletteId =
  | 'viridis' | 'cividis' | 'plasma' | 'magma' | 'inferno'
  | 'twilight' | 'cool_warm' | 'principia' | 'cubehelix';

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
};
