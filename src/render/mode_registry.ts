import type { ColourMode, BrightnessMode } from './types.js';

/**
 * Each colour mode declares the source field it reads. The renderer uses
 * this to verify the right `SimResult` / `ICDescriptor` field is bound
 * before dispatching the render pass.
 */
export const COLOUR_SOURCES: Record<ColourMode, string> = {
  event_class:        'sample_descriptor',
  energy:             'ICDescriptor.K_0+V_0',
  ang_momentum:       'SimResult.Lz_0',
  kinetic:            'ICDescriptor.K_0',
  potential:          'ICDescriptor.V_0',
  virial:             'ICDescriptor.virial_ratio',
  mass_ratio_12:      'ICDescriptor.m1/m2',
  mass_ratio_13:      'ICDescriptor.m1/m3',
  mass_fraction:      'ICDescriptor.q_mass',
  jacobi_rho1:        'ICDescriptor.rho1_mag',
  jacobi_rho2:        'ICDescriptor.rho2_mag',
  jacobi_ratio:       'ICDescriptor.rho_ratio',
  jacobi_angle:       'ICDescriptor.rho_angle',
  min_pair_dist:      'ICDescriptor.r_min_pair_0',
  escape_time:        'SimResult.t_end',
  close_encounters:   'sample_descriptor.encounter_count',
  min_approach:       'SimResult.d_min',
  energy_drift_abs:   'SimResult.delta_E_max_abs',
  energy_drift_rel:   'SimResult.energy_drift',
  lz_drift_abs:       'SimResult.delta_Lz_max_abs',
  lz_drift_rel:       'SimResult.Lz_drift',
  shape_sphere_vmf:   'SimResult.n_checkpoints[last]',
  shape_sphere_okabe_ito: 'SimResult.n_checkpoints[last]',
  stability_x_hue:    'SimResult.n_checkpoints[last] + diffusion',
  none:               '',                    // constant grey; brightness carries all
};

export const BRIGHTNESS_SOURCES: Record<BrightnessMode, string> = {
  flat:           '',
  time_to_event:  'SimResult.t_end',
  diffusion:      'SimResult.diffusion',
  bc_proximity:   'SimResult.n_checkpoints[last]',
  energy_drift:   'SimResult.energy_drift',
  ftle:           'SimResult.ftle (FTLE_VALID gated)',
};
