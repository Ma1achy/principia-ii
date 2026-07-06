import type { ChartFlags } from './types.js';

export const FLAGS_DEFAULT: ChartFlags = {
  forbids_energy_normalisation: false,
  has_redundant_hemisphere:     false,
  requires_per_pixel_mass:      false,
};

export const FLAGS_INVARIANT: ChartFlags = {
  ...FLAGS_DEFAULT,
  forbids_energy_normalisation: true,
};

export const FLAGS_SPHERE: ChartFlags = {
  ...FLAGS_DEFAULT,
  has_redundant_hemisphere: true,
};

export const FLAGS_MASS_VARYING: ChartFlags = {
  ...FLAGS_DEFAULT,
  requires_per_pixel_mass: true,
};
