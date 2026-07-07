import { describe, it, expect } from 'vitest';
import { classify, ErrorBoundary } from '@/error/boundary.js';
import { AppErrorKind, userMessage } from '@/error/kinds.js';
import {
  TILE_STATUS_FAIL, tileFlagDescriptor, hasTileFailure, TILE_STATUS_AT_F32_FLOOR,
} from '@/error/tile_status.js';
import {
  Telemetry, Level, InMemorySink, NoopSink,
} from '@/error/telemetry.js';
import { UnsupportedError } from '@/gpu/init.js';
import { DegenerateReason } from '@/decode/types.js';
import { TILE_STATUS } from '@/quadtree/reduction_types.js';

const fixedClock = (): number => 1_000;

describe('classify: each AppErrorKind', () => {
  it('UnsupportedError(no-webgpu) → Unsupported with reason', () => {
    const e = classify(new UnsupportedError('no-webgpu'));
    expect(e.kind).toBe(AppErrorKind.Unsupported);
    if (e.kind === AppErrorKind.Unsupported) {
      expect(e.reason).toBe('no-webgpu');
      expect(e.recoverable).toBe(false);
    }
  });

  it('GPUDeviceLostInfo shape → DeviceLost with gpuReason', () => {
    const e = classify({ reason: 'destroyed', message: 'device.destroy()' });
    expect(e.kind).toBe(AppErrorKind.DeviceLost);
    if (e.kind === AppErrorKind.DeviceLost) {
      expect(e.gpuReason).toBe('destroyed');
      expect(e.recoverable).toBe(true);
    }
  });

  it('statusFlags hint with SIM_FAILED → TileFailure', () => {
    const e = classify(undefined, {
      tileKey: '2/1/3', statusFlags: TILE_STATUS_FAIL.SIM_FAILED,
    });
    expect(e.kind).toBe(AppErrorKind.TileFailure);
    if (e.kind === AppErrorKind.TileFailure) {
      expect(e.tileKey).toBe('2/1/3');
      expect(e.flag & TILE_STATUS_FAIL.SIM_FAILED).toBeTruthy();
    }
  });

  it('DEGENERATE(reason) shape → Decode carrying the DegenerateReason', () => {
    const e = classify({ kind: 'DEGENERATE', reason: DegenerateReason.M01_TINY });
    expect(e.kind).toBe(AppErrorKind.Decode);
    if (e.kind === AppErrorKind.Decode) {
      expect(e.reason).toBe(DegenerateReason.M01_TINY);
    }
  });

  it('an unknown throwable → Generic', () => {
    const e = classify(new TypeError('kaboom'));
    expect(e.kind).toBe(AppErrorKind.Generic);
  });

  it('tile-failure hint takes priority over a thrown Error', () => {
    const e = classify(new Error('boom'), { statusFlags: TILE_STATUS_FAIL.TIMEOUT });
    expect(e.kind).toBe(AppErrorKind.TileFailure);
  });
});

describe('status_flags → descriptor mapping', () => {
  it('failure bits live above the schema-version field (bits 6-7)', () => {
    // decodeTileReduction strips bits 6-7; anything G11 owns must survive.
    const versionMask = 0x3 << 6;
    expect(TILE_STATUS_FAIL.SIM_FAILED & versionMask).toBe(0);
    expect(TILE_STATUS_FAIL.MAX_SUBSTEPS & versionMask).toBe(0);
    expect(TILE_STATUS_FAIL.TIMEOUT & versionMask).toBe(0);
    // ...and never collide with M5/G7's diagnostic bits 0-5.
    for (const v of Object.values(TILE_STATUS)) {
      expect(v & TILE_STATUS_FAIL.SIM_FAILED).toBe(0);
      expect(v & TILE_STATUS_FAIL.MAX_SUBSTEPS).toBe(0);
      expect(v & TILE_STATUS_FAIL.TIMEOUT).toBe(0);
    }
  });

  it('SIM_FAILED is an error-severity descriptor', () => {
    const d = tileFlagDescriptor(TILE_STATUS_FAIL.SIM_FAILED);
    expect(d.severity).toBe('error');
    expect(d.label).toBe('sim failed');
  });

  it('AT_F32_FLOOR alone is a warning, not a failure', () => {
    expect(hasTileFailure(TILE_STATUS_AT_F32_FLOOR)).toBe(false);
    expect(tileFlagDescriptor(TILE_STATUS_AT_F32_FLOOR).severity).toBe('warn');
  });

  it('error bits win over warn bits when both are set', () => {
    const flags = TILE_STATUS_FAIL.MAX_SUBSTEPS | TILE_STATUS_AT_F32_FLOOR;
    expect(tileFlagDescriptor(flags).severity).toBe('error');
  });

  it('clean flags → benign ok descriptor and no failure', () => {
    expect(hasTileFailure(0)).toBe(false);
    expect(tileFlagDescriptor(0).label).toBe('ok');
  });

  it('TIMEOUT maps to its timed-out message', () => {
    expect(tileFlagDescriptor(TILE_STATUS_FAIL.TIMEOUT).message).toMatch(/time budget/);
  });
});

describe('userMessage: stack-free, kind-appropriate prose', () => {
  it('Unsupported(no-webgpu) mentions WebGPU, not a stack', () => {
    const msg = userMessage(classify(new UnsupportedError('no-webgpu')));
    expect(msg).toMatch(/WebGPU/);
    expect(msg).not.toMatch(/at .+\(.+:\d+:\d+\)/); // no V8 stack frame
  });

  it('Generic message never leaks the underlying Error text', () => {
    const msg = userMessage(classify(new Error('SECRET_INTERNAL_DETAIL')));
    expect(msg).not.toMatch(/SECRET_INTERNAL_DETAIL/);
  });

  it('Decode message is reason-specific', () => {
    const msg = userMessage(
      classify({ kind: 'DEGENERATE', reason: DegenerateReason.INFEASIBLE_ENERGY }));
    expect(msg).toMatch(/energy/);
  });

  it('every DegenerateReason code has a catalogue message', () => {
    for (const reason of [10, 11, 12, 13, 14, 15, 16, 17] as DegenerateReason[]) {
      const msg = userMessage(classify({ kind: 'DEGENERATE', reason }));
      expect(msg.length, `reason ${reason}`).toBeGreaterThan(10);
      expect(msg).not.toMatch(/undefined/);
    }
  });
});

describe('Telemetry: level filtering + sink buffering', () => {
  it('drops records below minLevel before building them', () => {
    const sink = new InMemorySink();
    const t = new Telemetry({ minLevel: Level.Warn, sink, now: fixedClock });
    expect(t.info('hidden')).toBe(false);
    expect(t.warn('shown')).toBe(true);
    expect(sink.records()).toHaveLength(1);
    expect(sink.records()[0]!.message).toBe('shown');
  });

  it('stamps records with the injected clock and merged base context', () => {
    const sink = new InMemorySink();
    const t = new Telemetry({
      minLevel: Level.Debug, sink, now: fixedClock, base: { tier: 'research' },
    });
    t.error('boom', { tileKey: '0/0/0' });
    const r = sink.records()[0]!;
    expect(r.ts).toBe(1000);
    expect(r.level).toBe(Level.Error);
    expect(r.context).toMatchObject({ tier: 'research', tileKey: '0/0/0' });
  });

  it('child() inherits sink + minLevel and extends base context', () => {
    const sink = new InMemorySink();
    const t = new Telemetry({ minLevel: Level.Info, sink, now: fixedClock, base: { a: 1 } });
    t.child({ b: 2 }).info('msg');
    expect(sink.records()[0]!.context).toMatchObject({ a: 1, b: 2 });
  });

  it('NoopSink retains nothing; InMemorySink retains everything emitted', () => {
    const t = new Telemetry({ minLevel: Level.Debug, sink: new NoopSink(), now: fixedClock });
    expect(t.error('boom')).toBe(true);        // emitted (not filtered) ...
    const mem = new InMemorySink();
    new Telemetry({ minLevel: Level.Debug, sink: mem, now: fixedClock }).error('boom');
    expect(mem.records()).toHaveLength(1);
    expect(mem.at(Level.Error)).toHaveLength(1);
  });

  it('InMemorySink caps its buffer', () => {
    const sink = new InMemorySink(2);
    const t = new Telemetry({ minLevel: Level.Debug, sink, now: fixedClock });
    t.info('a'); t.info('b'); t.info('c');
    expect(sink.records()).toHaveLength(2);
    expect(sink.records().map(r => r.message)).toEqual(['b', 'c']);
  });
});

describe('ErrorBoundary: capture + wrap', () => {
  it('capture logs full detail to telemetry but returns a user-safe AppError', () => {
    const sink = new InMemorySink();
    const boundary = new ErrorBoundary(
      new Telemetry({ minLevel: Level.Debug, sink, now: fixedClock }),
    );
    const app = boundary.capture(new Error('SECRET'), { tileKey: 'k' });
    expect(app.kind).toBe(AppErrorKind.Generic);
    const rec = sink.records()[0]!;
    expect(rec.level).toBe(Level.Error);            // non-recoverable → error
    expect(rec.context['cause']).toMatch(/SECRET/); // detail in telemetry only
    expect(rec.message).not.toMatch(/SECRET/);      // user prose stays clean
  });

  it('recoverable errors log at warn level', () => {
    const sink = new InMemorySink();
    const boundary = new ErrorBoundary(
      new Telemetry({ minLevel: Level.Debug, sink, now: fixedClock }),
    );
    boundary.capture({ reason: 'destroyed', message: 'x' });
    expect(sink.records()[0]!.level).toBe(Level.Warn);
  });

  it('wrap returns ok:true on success', async () => {
    const boundary = new ErrorBoundary(new Telemetry());
    const r = await boundary.wrap(async () => 42);
    expect(r).toEqual({ ok: true, value: 42 });
  });

  it('wrap returns ok:false with a classified error on rejection', async () => {
    const sink = new InMemorySink();
    const boundary = new ErrorBoundary(
      new Telemetry({ minLevel: Level.Debug, sink, now: fixedClock }),
    );
    const r = await boundary.wrap(async () => { throw new UnsupportedError('no-adapter'); });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe(AppErrorKind.Unsupported);
    expect(sink.records()).toHaveLength(1);
  });

  it('onUserError hook receives the message, never the stack', () => {
    let seen = '';
    const boundary = new ErrorBoundary(new Telemetry(), {
      onUserError: (_a, msg) => { seen = msg; },
    });
    boundary.capture(new Error('INTERNAL'));
    expect(seen).toMatch(/Something went wrong/);
    expect(seen).not.toMatch(/INTERNAL/);
  });
});
