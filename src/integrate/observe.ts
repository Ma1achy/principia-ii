import type { TrajState } from './types.js';
import { totalEnergy, angularMomentum, minPairSeparation } from './forces.js';
import { EPS_ENERGY_FLOOR, EPS_LZ_FLOOR } from '@/math/constants.js';

/** Running diagnostics that update once per macro step. */
export class Observer {
  E0: number;
  Lz0: number;
  energyDriftAbsMax = 0;
  lzDriftAbsMax = 0;
  rMin: number;
  rMinPair: 0 | 1 | 2;
  totalSubsteps = 0;
  maxSubstepCount = 0;
  encounters = 0;

  constructor(s: TrajState) {
    this.E0  = totalEnergy(s.m, s.r, s.p);
    this.Lz0 = angularMomentum(s.r, s.p);
    const m = minPairSeparation(s.r);
    this.rMin = m.d;
    this.rMinPair = m.pair;
  }

  observe(s: TrajState, nSub: number, maxSub = nSub, rCloseEncounter = 0.01) {
    const E  = totalEnergy(s.m, s.r, s.p);
    const Lz = angularMomentum(s.r, s.p);
    this.energyDriftAbsMax = Math.max(this.energyDriftAbsMax, Math.abs(E  - this.E0));
    this.lzDriftAbsMax     = Math.max(this.lzDriftAbsMax,     Math.abs(Lz - this.Lz0));
    const m = minPairSeparation(s.r);
    if (m.d < this.rMin) { this.rMin = m.d; this.rMinPair = m.pair; }
    if (m.d < rCloseEncounter) this.encounters++;
    this.totalSubsteps   += nSub;
    // maxSubstepCount tracks the peak per-KDK substep count, not the Yoshida sum.
    this.maxSubstepCount  = Math.max(this.maxSubstepCount, maxSub);
  }

  finalDiagnostics(sFinal: TrajState) {
    const E  = totalEnergy(sFinal.m, sFinal.r, sFinal.p);
    const Lz = angularMomentum(sFinal.r, sFinal.p);
    const energyDrift = Math.abs(E  - this.E0)  / (Math.abs(this.E0)  + EPS_ENERGY_FLOOR);
    const lzDrift     = Math.abs(Lz - this.Lz0) / (Math.abs(this.Lz0) + EPS_LZ_FLOOR);
    return {
      E0: this.E0, Lz0: this.Lz0,
      energyDrift, lzDrift,
      energyDriftAbsMax: this.energyDriftAbsMax,
      lzDriftAbsMax: this.lzDriftAbsMax,
      rMin: this.rMin, rMinPair: this.rMinPair,
      tEnd: sFinal.t,
      totalSubsteps: this.totalSubsteps,
      maxSubstepCount: this.maxSubstepCount,
      encounters: this.encounters,
    };
  }
}
