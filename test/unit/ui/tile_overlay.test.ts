// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from '@/app/app.js';
import type { GpuDispatcher } from '@/app/types.js';
import type { InspectorResult } from '@/inspector/types.js';
import type { CachedTile } from '@/quadtree/types.js';
import { TILE_STATUS } from '@/quadtree/index.js';
import { mountTileOverlay } from '@/ui/TileOverlay.js';
import { stubReduction } from '../../helpers/stub_reduction.js';

function makeApp(): App {
  const d: GpuDispatcher = {
    dispatchTile: async (id) => stubReduction(id),
    cancel: () => {}, render: () => {},
    inspect: async () => ({} as InspectorResult),
  };
  return new App(d, { now: () => 0, schedule: () => 0, cancel: () => {} });
}

interface RectCall { x: number; y: number; w: number; h: number; style: string }
function recordingCtx(): { fills: RectCall[]; strokes: RectCall[]; ctx: CanvasRenderingContext2D } {
  const fills: RectCall[] = [];
  const strokes: RectCall[] = [];
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    setTransform: () => {}, clearRect: () => {},
    fillRect: (x: number, y: number, w: number, h: number) =>
      fills.push({ x, y, w, h, style: (ctx as unknown as { fillStyle: string }).fillStyle }),
    strokeRect: (x: number, y: number, w: number, h: number) =>
      strokes.push({ x, y, w, h, style: (ctx as unknown as { strokeStyle: string }).strokeStyle }),
  };
  return { fills, strokes, ctx: ctx as unknown as CanvasRenderingContext2D };
}

// A 100×100 CSS-px canvas at the origin, dpr=1: the [0,1]² UV domain maps 1:1.
function boxAt(w = 100, h = 100): DOMRect {
  return { left: 0, top: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0,
    toJSON: () => ({}) } as DOMRect;
}

describe('TileOverlay — CPU quadtree/decode overlay', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
  });

  function setup(entries: CachedTile[]): {
    rec: ReturnType<typeof recordingCtx>; app: App; area: HTMLElement; select: HTMLSelectElement;
    dispose: () => void;
  } {
    const area = document.createElement('div');
    const controlArea = document.createElement('div');
    document.body.append(area, controlArea);
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => boxAt();
    area.getBoundingClientRect = () => boxAt();
    const rec = recordingCtx();
    // Overlay canvas is created inside mount(); force its 2D context to record.
    const realCreate = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
      const el = realCreate(tag);
      if (tag === 'canvas') (el as HTMLCanvasElement).getContext = (() => rec.ctx) as never;
      return el;
    }) as typeof document.createElement;
    const app = makeApp();
    (app.loop.cache as unknown as { entries: () => CachedTile[] }).entries = () => entries;
    const dispose = mountTileOverlay(area, controlArea, app, canvas);
    document.createElement = realCreate;
    const select = controlArea.querySelector<HTMLSelectElement>('#tileOverlay')!;
    return { rec, app, area, select, dispose };
  }

  const tile = (z: number, tx: number, ty: number, flags = 0): CachedTile => ({
    id: { z, tx, ty }, simBuffer: null, icBuffer: null,
    lifecycle: 'ready', cacheAge: 0, lastUsed: 0, computeCostMs: 0,
    reduction: flags ? ({ status_flags: flags } as CachedTile['reduction']) : null,
  });

  it('mounts an overlay canvas + control and cleans up on dispose', () => {
    const { area, select, dispose } = setup([]);
    expect(area.querySelector('.tile-overlay')).not.toBeNull();
    expect(select).not.toBeNull();
    dispose();
    expect(area.querySelector('.tile-overlay')).toBeNull();
  });

  it('draws the root tile as the full-canvas rect (transform is correct)', () => {
    const { rec, app, select } = setup([tile(0, 0, 0)]);
    select.value = 'boundaries';
    select.dispatchEvent(new Event('change'));
    app.store.update((v) => ({ ...v }));          // fire the store → redraw
    const root = rec.strokes.at(-1)!;
    expect(root.x).toBeCloseTo(0, 6);
    expect(root.y).toBeCloseTo(0, 6);
    expect(root.w).toBeCloseTo(100, 6);
    expect(root.h).toBeCloseTo(100, 6);
  });

  it('a depth-1 child maps to its quadrant (y measured downward)', () => {
    const { rec, app, select } = setup([tile(1, 1, 1)]);   // bottom-right quadrant
    select.value = 'boundaries';
    select.dispatchEvent(new Event('change'));
    app.store.update((v) => ({ ...v }));
    const q = rec.strokes.at(-1)!;
    expect(q.x).toBeCloseTo(50, 6);
    expect(q.y).toBeCloseTo(50, 6);
    expect(q.w).toBeCloseTo(50, 6);
    expect(q.h).toBeCloseTo(50, 6);
  });

  it('decode mode fills f32-floor tiles red, linearised purple', () => {
    const { rec, app, select } = setup([
      tile(0, 0, 0, TILE_STATUS.AT_F32_FLOOR),
    ]);
    select.value = 'decode';
    select.dispatchEvent(new Event('change'));
    app.store.update((v) => ({ ...v }));
    expect(rec.fills.at(-1)!.style).toContain('230,60,60');   // red = f32 floor
  });
});
