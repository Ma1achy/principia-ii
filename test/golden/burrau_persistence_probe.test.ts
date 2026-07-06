import { describe, it, expect } from 'vitest';
import { defaultViewState } from '@/interact/view_state.js';
import { probePersistence } from '@/burrau/hypothesis_probe.js';

describe('Stage 4 persistence probe: trace is finite and monotone', () => {
  it('produces a 30-step trace without throwing, with monotone tau', async () => {
    let counter = 0;
    const fakeSummary = () => {
      counter++;
      return Promise.resolve({
        outcome_impurity: 0.5 - 0.4 * (counter / 30),
        coherence_score: 0.3,
        word: 'abAB',
      });
    };
    const { trace, verdict } = await probePersistence(
      defaultViewState(), { s: 0.5, t: 0.5 }, /* tiltTarget */ 5,
      30, fakeSummary,
    );
    expect(trace).toHaveLength(30);
    for (let i = 1; i < trace.length; i++) {
      expect(trace[i]!.tau).toBeGreaterThanOrEqual(trace[i - 1]!.tau);
    }
    // outcome_impurity should be (synthetically) monotone-decreasing here.
    expect(trace[trace.length - 1]!.outcomeImpurity)
      .toBeLessThan(trace[0]!.outcomeImpurity);
    // Synthetic impurity ends at 0.1 < tau_imp, so the boundary is
    // classified dissolved — the probe yields a verdict, not just a trace.
    expect(verdict).toBe('dissolves');
  });
});
