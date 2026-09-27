import { describe, it, expect } from 'vitest';
import { perfHudVM, budgetBucket } from '@/devhud/perf_view.js';
import { errorOverlayVM, appErrorRow } from '@/devhud/error_view.js';
import { validationVM, FTLE_DELTA_THRESHOLD } from '@/devhud/validation_view.js';
import {
  extendCapture, captureSeeds, checkCaptureReplayable, liveCaptureFrom,
  type FrameCaptureV2,
} from '@/devhud/capture.js';
import {
  initDevOverlay, devOverlayReducer, DEV_TABS,
} from '@/devhud/overlay_state.js';
import type { PerfSnapshot, PerfRecommendation } from '@/perf/perf_monitor.js';
import { Telemetry, Level, InMemorySink } from '@/error/telemetry.js';
import { AppErrorKind, type AppError } from '@/error/kinds.js';
import { TILE_STATUS_FAIL, TILE_STATUS_AT_F32_FLOOR } from '@/error/tile_status.js';
import type { InspectorResult } from '@/inspector/types.js';
import { jitterOffsets } from '@/quadtree/ensemble_jitter.js';
import { defaultViewState, viewStateToCacheKey } from '@/interact/view_state.js';
import { serialiseCacheKey } from '@/quadtree/cache_key.js';

const snap = (over: Partial<PerfSnapshot> = {}): PerfSnapshot => ({
  frames: 120, cpuMeanMs: 8, cpuP95Ms: 12,
  gpuP95Ms: {}, gpuTimingAvailable: false,
  budget: 'ok', overFraction: 0,
  ...over,
});
const rec = (over: Partial<PerfRecommendation> = {}): PerfRecommendation => ({
  dispatchCapScale: 1, recommendTier: null, reason: 'within budget', ...over,
});

describe('perfHudVM: budget bucket + rows', () => {
  it('maps the three budget states onto colour buckets', () => {
    expect(budgetBucket('ok')).toBe('ok');
    expect(budgetBucket('over')).toBe('warn');
    expect(budgetBucket('sustained')).toBe('bad');
  });

  it('CPU-only snapshot yields no GPU rows', () => {
    const vm = perfHudVM(snap({ gpuTimingAvailable: false }), rec());
    expect(vm.gpuRows).toHaveLength(0);
    expect(vm.gpuTimingAvailable).toBe(false);
  });

  it('surfaces per-pass GPU rows when timestamp-query is present', () => {
    const vm = perfHudVM(snap({
      gpuTimingAvailable: true,
      gpuP95Ms: { simulate: 14, reduce: 3 },
    }), rec());
    expect(vm.gpuRows.map(r => r.pass)).toEqual(['simulate', 'reduce']);
    expect(vm.gpuRows[0]!.p95Ms).toBe(14);
  });

  it('surfaces the recommend() hint read-only (cap %, tier, reason)', () => {
    const vm = perfHudVM(
      snap({ budget: 'sustained', overFraction: 1 }),
      rec({ dispatchCapScale: 0.25, recommendTier: 'balanced', reason: 'research → balanced' }),
    );
    expect(vm.bucket).toBe('bad');
    expect(vm.overPercent).toBe(100);
    expect(vm.recommendation.capScalePercent).toBe(25);
    expect(vm.recommendation.recommendTier).toBe('balanced');
    expect(vm.recommendation.reason).toMatch(/balanced/);
  });
});

describe('errorOverlayVM: telemetry rows + tile-failure roll-up', () => {
  const fill = (sink: InMemorySink): void => {
    const t = new Telemetry({ minLevel: Level.Debug, sink, now: () => 1000 });
    t.info('debug-noise');                                    // below Warn → excluded
    t.warn('The GPU connection was lost and is being restored.',
      { kind: AppErrorKind.DeviceLost, recoverable: true });
    t.error('Something went wrong while computing this region.',
      { kind: AppErrorKind.Generic, recoverable: false });
  };

  it('lists only Warn+ rows, most-recent first, with counts', () => {
    const sink = new InMemorySink();
    fill(sink);
    const vm = errorOverlayVM(sink);
    expect(vm.rows).toHaveLength(2);
    expect(vm.rows[0]!.message).toMatch(/went wrong/);       // last in, first out
    expect(vm.errorCount).toBe(1);
    expect(vm.warnCount).toBe(1);
    expect(vm.rows[0]!.recoverable).toBe(false);
  });

  it('never includes a record below Warn (no debug noise)', () => {
    const sink = new InMemorySink();
    fill(sink);
    expect(errorOverlayVM(sink).rows.some(r => r.level < Level.Warn)).toBe(false);
  });

  it('splits failed tiles (hard bit) from warned tiles (f32 floor)', () => {
    const sink = new InMemorySink();
    const flags = new Map<string, number>([
      ['2/1/3', TILE_STATUS_FAIL.SIM_FAILED],
      ['2/1/4', TILE_STATUS_AT_F32_FLOOR],
      ['2/1/5', 0],                                           // clean → neither list
    ]);
    const vm = errorOverlayVM(sink, flags);
    expect(vm.failedTiles.map(t => t.tileKey)).toEqual(['2/1/3']);
    expect(vm.failedTiles[0]!.descriptor.severity).toBe('error');
    expect(vm.warnedTiles.map(t => t.tileKey)).toEqual(['2/1/4']);
    expect(vm.warnedTiles[0]!.descriptor.severity).toBe('warn');
  });

  it('appErrorRow builds a stack-free row from a live AppError', () => {
    const e: AppError = { kind: AppErrorKind.Generic, recoverable: false };
    const row = appErrorRow(e, 42);
    expect(row.ts).toBe(42);
    expect(row.level).toBe(Level.Error);
    expect(row.message).toMatch(/went wrong/);
    expect(row.message).not.toMatch(/at .+\(.+:\d+:\d+\)/);   // no V8 stack frame
  });
});

describe('validationVM: M9 validation slot', () => {
  const base = (over: Partial<InspectorResult> = {}): InspectorResult => ({
    t: [], r: [], p: [], nShape: [], energy: [], lz: [],
    outcome: 'bounded', tEnd: 5, dMin: 0.1, deltaEMax: 0, ftle: 0, diffusion: -1,
    freeGroupWord: '', ic: { m: [1, 1, 1] as any, r: [] as any, p: [] as any },
    nSteps: 0, nReject: 0, cpuMs: 0,
    ...over,
  });

  it('absent validation → available:false, not flagged', () => {
    const vm = validationVM(base());
    expect(vm.available).toBe(false);
    expect(vm.flagged).toBe(false);
    expect(vm.outcome).toBe('bounded');
  });

  it('all-agree validation → available, not flagged', () => {
    const vm = validationVM(base({
      validation: { gpuOutcomeAgrees: true, gpuFtleDelta: 0.01, gpuWordAgrees: true },
    }));
    expect(vm.available).toBe(true);
    expect(vm.flagged).toBe(false);
  });

  it('flags an FTLE delta past the threshold', () => {
    const vm = validationVM(base({
      validation: {
        gpuOutcomeAgrees: true,
        gpuFtleDelta: FTLE_DELTA_THRESHOLD + 0.05,
        gpuWordAgrees: true,
      },
    }));
    expect(vm.flagged).toBe(true);
  });

  it('flags an outcome disagreement', () => {
    const vm = validationVM(base({
      validation: { gpuOutcomeAgrees: false, gpuFtleDelta: 0, gpuWordAgrees: true },
    }));
    expect(vm.flagged).toBe(true);
  });
});

describe('overlay toggle reducer', () => {
  it('starts hidden on the perf tab', () => {
    const s = initDevOverlay();
    expect(s.visible).toBe(false);
    expect(s.tab).toBe('perf');
    expect(DEV_TABS).toContain('capture');
  });

  it('toggle flips visibility', () => {
    const s0 = initDevOverlay();
    const s1 = devOverlayReducer(s0, { type: 'toggle' });
    expect(s1.visible).toBe(true);
    expect(devOverlayReducer(s1, { type: 'toggle' }).visible).toBe(false);
  });

  it('selecting a tab also reveals the overlay', () => {
    const s = devOverlayReducer(initDevOverlay(), { type: 'selectTab', tab: 'capture' });
    expect(s.visible).toBe(true);
    expect(s.tab).toBe('capture');
  });
});

describe('extended frame-capture: ViewState + ensemble seeds', () => {
  // There is no EnsembleConfig type in @/gpu/ensemble.js — G7 carries
  // E/patternId in the TileRequest, so the capture API takes them
  // structurally (see src/devhud/capture.ts).
  const ensembleCfg = (E: number, patternId: 0 | 1 | 2): { E: number; patternId: 0 | 1 | 2 } =>
    ({ E, patternId });
  // G17 CapturedFrame base record: version/N/M/uniforms/tile/chart/label?
  const baseFrame = () =>
    ({ version: 2, N: 256, M: 64, uniforms: {}, tile: {}, chart: {} }) as any;

  it('captureSeeds reproduces G7 jitterOffsets for (patternId, E)', () => {
    const seeds = captureSeeds(ensembleCfg(4, 1));
    const expected = jitterOffsets(1, 4);
    expect(seeds.E).toBe(4);
    expect(seeds.patternId).toBe(1);
    expect(seeds.offsets).toHaveLength(expected.length);
    expect(seeds.offsets[0]).toEqual({ du: expected[0]!.du, dv: expected[0]!.dv });
  });

  it('extendCapture attaches the full ViewState and a matching cacheKey', () => {
    const view = { ...defaultViewState(), chartType: 'lz_e' };
    const cap: FrameCaptureV2 = extendCapture(baseFrame(), view, ensembleCfg(4, 2));
    expect(cap.N).toBe(256);                                  // base field preserved
    expect(cap.view.chartType).toBe('lz_e');
    expect(cap.cacheKey).toBe(serialiseCacheKey(viewStateToCacheKey(view)));
    expect(cap.seeds.E).toBe(4);
  });

  it('a freshly-extended capture is replayable (no mismatches)', () => {
    const cap = extendCapture(baseFrame(), defaultViewState(), ensembleCfg(2, 0));
    expect(checkCaptureReplayable(cap)).toEqual([]);
  });

  it('liveCaptureFrom builds a replayable V2 from the last dispatch', () => {
    // Structural LastDispatch: the glue only reads N/M/uniforms/tile/chart
    // plus the tile's own ensemble fields for the seeds.
    const d = {
      N: 16, M: 8,
      uniforms: { samples_per_axis: 16 } as any,
      tile: { ensemble_e: 4, sample_pattern_id: 1 } as any,
      chart: {} as any,
    };
    const cap = liveCaptureFrom(d, defaultViewState());
    expect(cap).not.toBeNull();
    expect(cap!.N).toBe(16);
    expect(cap!.M).toBe(8);
    expect(cap!.label).toBe('live');
    expect(cap!.seeds.E).toBe(4);
    expect(cap!.seeds.patternId).toBe(1);
    expect(checkCaptureReplayable(cap!)).toEqual([]);
  });

  it('liveCaptureFrom is null before the first dispatch', () => {
    expect(liveCaptureFrom(null, defaultViewState())).toBeNull();
  });

  it('detects a tampered cacheKey / seed table on replay check', () => {
    const good = extendCapture(baseFrame(), defaultViewState(), ensembleCfg(2, 0));
    const tampered: FrameCaptureV2 = {
      ...good,
      cacheKey: 'not-the-real-key',
      seeds: { ...good.seeds, offsets: [{ du: 9, dv: 9 }] },
    };
    const problems = checkCaptureReplayable(tampered);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some(p => /cacheKey/.test(p))).toBe(true);
  });
});
