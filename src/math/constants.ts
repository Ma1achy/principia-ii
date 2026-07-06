/** Dimensionless unit system used everywhere except quoted physical examples. */
export const G = 1;
export const M_TOTAL = 1;          // Σ m_i = 1
export const I_GAUGE = 1;           // moment of inertia after the scale gauge

/** Numerical floors and clamps from spec Appendix A. */
export const EPS_DECODE       = 1e-6;     // sigmoid clamp
export const EPS_DEADBAND     = 1e-12;    // mirror rule deadband
export const EPS_ENERGY_FLOOR = 1e-6;     // for relative drift metric
export const EPS_LZ_FLOOR     = 1e-6;
export const EPS_BOLT         = 1e-30;    // virial denominator floor

/** Decode hyperparameters (spec Appendix A defaults). */
export const MU_MAX_DEFAULT     = 5;     // mass logit saturation
export const ALPHA_MIN_DEFAULT  = 0.05;  // hyperspherical buffer (radians)
export const Q_MAX_DEFAULT      = 2;     // free-momentum cap

/** Event thresholds. */
export const R_COLL_DEFAULT     = 1e-4;
export const R_ESC_DEFAULT      = 10;
export const K_ESC_DEFAULT      = 8;     // escape persistence count

/** Substepping. */
export const R_SUB_DEFAULT      = 0.05;
export const GAMMA_SUB_DEFAULT  = 1.5;
export const N_MAX_DEFAULT      = 64;
export const DT_MACRO_DEFAULT   = 1e-3;
export const T_HORIZON_DEFAULT  = 80;    // long enough for Burrau resolution
