import type { Chart, ChartView } from '../types.js';
import { FLAGS_DEFAULT } from '../flags.js';
import { CHART_UNIFORMS_DEFAULTS } from '@/gpu/chart_uniforms.js';
import { realiseFrozenConfig } from '../frozen_configuration.js';
import {
  jacobiToParticlePositions, jacobiToParticleMomenta,
  particlePositionsToJacobi, particleMomentaToJacobi,
} from '@/decode/jacobi_particle.js';
import { canonicalise } from '@/decode/canonicalise.js';
import { makeDescriptor } from '@/decode/pipeline.js';
import type { Triple, Vec2, Vec3 } from '@/math/types.js';

/**
 * Dedicated inner/outer Jacobi charts (spec audit: position and momentum
 * views over ρ = r1 − r0 and λ = r2 − com01, the descriptor's rho1/rho2).
 *
 * Both charts freeze their geometry so that the canonical gauge is already
 * satisfied at construction (ρ along +x̂, λ_y ≥ 0), making canonicalisation
 * a no-op and the inverses EXACT within range:
 *
 * - jacobi_position: u → |ρ| (inner separation), v → |λ| (outer
 *   separation); the ρ–λ angle, masses and Jacobi momenta are frozen
 *   chart params.
 * - jacobi_momentum: u → signed p_ρ component, v → signed p_λ component
 *   along frozen direction angles, at a frozen (α, β) configuration.
 */

const num = (view: ChartView, key: string, dflt: number): number => {
  const x = view.chartParams[key];
  return typeof x === 'number' && Number.isFinite(x) ? x : dflt;
};
const massesOf = (view: ChartView): Vec3 => view.m ?? [1 / 3, 1 / 3, 1 / 3];
const lerp = (lo: number, hi: number, t: number): number => lo + (hi - lo) * t;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

function finish(
  r: Triple<Vec2>, p: Triple<Vec2>, m: Vec3, view: ChartView,
): ReturnType<Chart['decode']> {
  const c = canonicalise({ r, p, m, t: 0 },
                         { deltaLambda: view.deltaLambda, rColl: view.rColl });
  if (c.terminal) {
    return { kind: 'terminal', terminal: c.terminal,
             descriptor: makeDescriptor(c.state) };
  }
  return { kind: 'ok', state: c.state, descriptor: makeDescriptor(c.state) };
}

export const jacobiPositionChart: Chart = {
  id: 'jacobi_position',
  kind: 'mixed',
  flags: FLAGS_DEFAULT,
  chartUniforms() { return CHART_UNIFORMS_DEFAULTS; },

  decode([u, v], view) {
    const m = massesOf(view);
    const rhoMag    = lerp(num(view, 'rhoMin', 0.05),    num(view, 'rhoMax', 2), u);
    const lambdaMag = lerp(num(view, 'lambdaMin', 0.05), num(view, 'lambdaMax', 3), v);
    // Frozen ρ–λ angle in (0, π) keeps λ_y ≥ 0 (mirror gauge already met).
    const theta = Math.min(Math.max(num(view, 'rhoAngle', Math.PI / 2), 1e-3), Math.PI - 1e-3);
    const rho:    Vec2 = [rhoMag, 0];
    const lambda: Vec2 = [lambdaMag * Math.cos(theta), lambdaMag * Math.sin(theta)];
    const r = jacobiToParticlePositions(rho, lambda, m);
    const pRho: Vec2 = [num(view, 'pRhoX', 0), num(view, 'pRhoY', 0)];
    const pLam: Vec2 = [num(view, 'pLambdaX', 0), num(view, 'pLambdaY', 0)];
    const p = jacobiToParticleMomenta({ pRho, pLambda: pLam }, m);
    return finish(r, p, m, view);
  },

  inverseEncode(ic, view) {
    const dflt: ChartView = view ?? ({ chartParams: {} } as ChartView);
    const { rho, lambda } = particlePositionsToJacobi(ic.r, ic.m);
    const rhoMag = Math.hypot(rho[0], rho[1]);
    const lambdaMag = Math.hypot(lambda[0], lambda[1]);
    const rLo = num(dflt, 'rhoMin', 0.05),    rHi = num(dflt, 'rhoMax', 2);
    const lLo = num(dflt, 'lambdaMin', 0.05), lHi = num(dflt, 'lambdaMax', 3);
    const s = (rhoMag - rLo) / (rHi - rLo);
    const t = (lambdaMag - lLo) / (lHi - lLo);
    const clamped = s < 0 || s > 1 || t < 0 || t > 1;
    return { kind: clamped ? 'projected' : 'exact',
             pixel: { s: clamp01(s), t: clamp01(t) }, clamped };
  },

  validate([u, v]) {
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      return { kind: 'reject', reason: 'uv out of range' };
    }
    return { kind: 'pass' };
  },
};

export const jacobiMomentumChart: Chart = {
  id: 'jacobi_momentum',
  kind: 'mixed',
  flags: FLAGS_DEFAULT,
  chartUniforms() { return CHART_UNIFORMS_DEFAULTS; },

  decode([u, v], view) {
    const m = massesOf(view);
    // Frozen geometry: realiseFrozenConfig puts ρ on +x̂ with λ_y ≥ 0, so
    // the canonical gauge holds at construction (rotation = identity).
    const alpha = num(view, 'alpha', Math.PI / 4);
    const beta  = num(view, 'beta', Math.PI / 2);
    const r = realiseFrozenConfig(alpha, beta, m);
    const pMax = num(view, 'pMax', 2);
    const pr = lerp(-pMax, pMax, u);            // signed p_ρ component
    const pl = lerp(-pMax, pMax, v);            // signed p_λ component
    const thR = num(view, 'pRhoAngle', Math.PI / 2);
    const thL = num(view, 'pLambdaAngle', Math.PI / 2);
    const pRho:    Vec2 = [pr * Math.cos(thR), pr * Math.sin(thR)];
    const pLambda: Vec2 = [pl * Math.cos(thL), pl * Math.sin(thL)];
    const p = jacobiToParticleMomenta({ pRho, pLambda }, m);
    return finish(r, p, m, view);
  },

  inverseEncode(ic, view) {
    const dflt: ChartView = view ?? ({ chartParams: {} } as ChartView);
    const { pRho, pLambda } = particleMomentaToJacobi(ic.p, ic.m);
    const thR = num(dflt, 'pRhoAngle', Math.PI / 2);
    const thL = num(dflt, 'pLambdaAngle', Math.PI / 2);
    const pMax = num(dflt, 'pMax', 2);
    // Signed components along the frozen directions; the perpendicular
    // residual measures how far the state is from this chart's plane.
    const pr = pRho[0] * Math.cos(thR) + pRho[1] * Math.sin(thR);
    const pl = pLambda[0] * Math.cos(thL) + pLambda[1] * Math.sin(thL);
    const perp = Math.hypot(
      pRho[0] - pr * Math.cos(thR), pRho[1] - pr * Math.sin(thR),
      pLambda[0] - pl * Math.cos(thL), pLambda[1] - pl * Math.sin(thL));
    const s = (pr + pMax) / (2 * pMax);
    const t = (pl + pMax) / (2 * pMax);
    const clamped = s < 0 || s > 1 || t < 0 || t > 1 || perp > 1e-9;
    return { kind: clamped ? 'projected' : 'exact',
             pixel: { s: clamp01(s), t: clamp01(t) }, clamped };
  },

  validate([u, v]) {
    if (u < 0 || u > 1 || v < 0 || v > 1) {
      return { kind: 'reject', reason: 'uv out of range' };
    }
    return { kind: 'pass' };
  },
};
