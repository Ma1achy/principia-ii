import type { ViewState } from '@/interact/view_state.js';
import { lockAffine } from '@/interact/lock.js';
import { setTilts } from '@/interact/tilt.js';

export interface PersistenceTracePoint {
  tau:               number;
  outcomeImpurity:   number;     // from TileReduction
  coherenceScore:    number;
  freeGroupWord:     string | null;
}

export type PersistenceVerdict = 'persists' | 'deforms' | 'dissolves';

export interface PersistenceResult {
  trace:   PersistenceTracePoint[];
  verdict: PersistenceVerdict;
}

/**
 * Classify a persistence trace per spec 2.5. A live basin boundary keeps
 * the locked pixel mixed (outcome_impurity stays high). If impurity
 * collapses toward 0 the boundary has dissolved; if it stays high but the
 * free-group word changes, the boundary persisted but deformed; otherwise
 * it persisted intact. Threshold matches the tile split criterion
 * (tau_imp) so "boundary" here means what the renderer means.
 */
export function classifyPersistence(
  trace: PersistenceTracePoint[],
  tauImp = 0.15,
): PersistenceVerdict {
  if (trace.length === 0) return 'dissolves';
  const endImpurity = trace[trace.length - 1]!.outcomeImpurity;
  if (endImpurity < tauImp) return 'dissolves';
  const w0 = trace[0]!.freeGroupWord;
  const wEnd = trace[trace.length - 1]!.freeGroupWord;
  return w0 !== wEnd ? 'deforms' : 'persists';
}

/**
 * Stage-4 persistence probe: lock at a Burrau basin boundary, then
 * sweep tilt₁ from 0 to π/2 along a chosen latent dimension. Returns
 * the per-tilt summary so the caller can plot persistence.
 *
 * Caller supplies a `tileSummary` function that, given a `ViewState`,
 * returns the visible tile's `TileReduction`. This decouples the probe
 * from the GPU dispatcher.
 */
export async function probePersistence(
  startView: ViewState,
  pixel: { s: number; t: number },
  tiltTarget: number,
  steps: number,
  tileSummary: (v: ViewState) => Promise<{
    outcome_impurity: number;
    coherence_score:  number;
    word?:            string;
  }>,
): Promise<PersistenceResult> {
  const trace: PersistenceTracePoint[] = [];
  const locked = lockAffine(startView, pixel);
  for (let i = 0; i < steps; i++) {
    const tau = (i / Math.max(1, steps - 1)) * (Math.PI / 2);
    const tilted = setTilts(locked, { tilt1: tau, tilt1Target: tiltTarget });
    const summary = await tileSummary(tilted);
    trace.push({
      tau,
      outcomeImpurity: summary.outcome_impurity,
      coherenceScore:  summary.coherence_score,
      freeGroupWord:   summary.word ?? null,
    });
  }
  return { trace, verdict: classifyPersistence(trace) };
}
