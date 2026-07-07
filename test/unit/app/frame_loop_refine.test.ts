import { describe, it, expect } from 'vitest';
import { App } from '@/app/app.js';
import type { GpuDispatcher, FrameDeps, RenderPlan } from '@/app/types.js';
import type { InspectorResult } from '@/inspector/types.js';
import { REFINE_LEVELS_MAX } from '@/quadtree/scheduler.js';
import { defaultViewState } from '@/interact/view_state.js';
import { stubReduction } from '../../helpers/stub_reduction.js';

/**
 * Live depth refinement, end to end through the frame loop with a stub
 * dispatcher: impure tiles refine themselves into children/grandchildren
 * (dispatched, then drawn ON TOP of their parent), the descent cap holds,
 * and maxDepth switches the whole feature off.
 */

const makeDeps = (): FrameDeps => {
  let now = 0;
  return { now: () => now++, schedule: () => 0, cancel: () => {} };
};

function makeStub(impurity: number): { d: GpuDispatcher; plans: RenderPlan[] } {
  const plans: RenderPlan[] = [];
  const d: GpuDispatcher = {
    dispatchTile: async (tileId) =>
      ({ ...stubReduction(tileId), outcome_impurity: impurity }),
    cancel: () => {},
    render: (plan) => { plans.push(plan); },
    inspect: async () => ({} as InspectorResult),
  };
  return { d, plans };
}

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

/** Tick until no new jobs get dispatched and nothing is in flight. */
async function settle(app: App, maxTicks = 200): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    const stats = app.loop.tickOnce();
    await flush();
    if (stats.jobsDispatched === 0 && app.loop.ledger.inflightCount === 0) return;
  }
  throw new Error('frame loop never settled');
}

describe('FrameLoop live depth refinement', () => {
  it('impure tiles refine to the descent cap and children draw over parents', async () => {
    const { d, plans } = makeStub(0.5);                  // every tile impure
    const app = new App(d, makeDeps(), { frameBudget: 32, maxInFlight: 32 });
    await settle(app);

    const zBase = (): number => {
      const p = plans[plans.length - 1]!;
      return Math.min(...p.entries.map((e) => e.tile.z));
    };
    const last = plans[plans.length - 1]!;
    const base = zBase();
    const depths = new Set(last.entries.map((e) => e.tile.z - base));
    // Parent + both refinement levels are all drawn, nothing beyond the cap.
    expect(depths.has(0)).toBe(true);
    expect(depths.has(1)).toBe(true);
    expect(depths.has(REFINE_LEVELS_MAX)).toBe(true);
    expect(Math.max(...depths)).toBe(REFINE_LEVELS_MAX);
    // Children render AFTER their parent (progressive overlay order).
    for (const e of last.entries) {
      if (e.tile.z === base) continue;
      const parentIdx = last.entries.findIndex((p) =>
        p.tile.z === base
        && (e.tile.tx >> (e.tile.z - base)) === p.tile.tx
        && (e.tile.ty >> (e.tile.z - base)) === p.tile.ty);
      expect(parentIdx).toBeGreaterThanOrEqual(0);
      expect(last.entries.indexOf(e)).toBeGreaterThan(parentIdx);
    }
    expect(app.loop.lastStats?.refined ?? 0).toBeGreaterThan(0);
  });

  it('coherent tiles never refine (no children dispatched or drawn)', async () => {
    const { d, plans } = makeStub(0);                    // perfectly coherent
    const app = new App(d, makeDeps(), { frameBudget: 32, maxInFlight: 32 });
    await settle(app);
    const last = plans[plans.length - 1]!;
    const zs = new Set(last.entries.map((e) => e.tile.z));
    expect(zs.size).toBe(1);                             // frontier only
    expect(app.loop.lastStats?.refined).toBeUndefined();
  });

  it('maxDepth at the frontier disables refinement entirely', async () => {
    const initialView = defaultViewState();
    const { d, plans } = makeStub(0.5);
    const app = new App(d, makeDeps(), {
      frameBudget: 32, maxInFlight: 32,
      // Clamp the ceiling to the boot frontier: zoomLevel() ≤ maxDepth,
      // so every visible tile sits AT the ceiling and stays plain ready.
      initialView: { ...initialView, maxDepth: 0 },
    });
    await settle(app);
    const last = plans[plans.length - 1]!;
    expect(new Set(last.entries.map((e) => e.tile.z)).size).toBe(1);
    expect(app.loop.lastStats?.refined).toBeUndefined();
  });
});
