// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { App } from '@/app/app.js';
import { mountUI } from '@/ui/App.js';
import type { GpuDispatcher } from '@/app/types.js';
import type { InspectorResult } from '@/inspector/types.js';
import { stubReduction } from '../helpers/stub_reduction.js';

function stubDispatcher(): GpuDispatcher {
  return {
    dispatchTile: async (id) => stubReduction(id),
    cancel: () => {},
    render: () => {},
    inspect: async () => ({} as InspectorResult),
  };
}

function makeApp(): App {
  return new App(stubDispatcher(), {
    now: () => 0, schedule: () => 0, cancel: () => {},
  });
}

describe('UI smoke (G8, headless DOM)', () => {
  it('mountUI renders the layout, panel, canvas and inspector', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const canvas = document.createElement('canvas');
    const app = makeApp();
    const unmount = mountUI(root, app, canvas);

    expect(root.querySelector('.layout')).not.toBeNull();
    expect(root.querySelector('.canvas-area canvas')).toBe(canvas);
    expect(root.querySelector('#chart')).not.toBeNull();
    expect(root.querySelectorAll('input[type=range]').length)
      .toBeGreaterThanOrEqual(9);                     // 8 sliders + tilt
    expect(root.querySelector('.inspector')).not.toBeNull();
    unmount();
  });

  it('a slider input writes through to the store; store writes reflect back', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = makeApp();
    mountUI(root, app, document.createElement('canvas'));

    const z3 = root.querySelector<HTMLInputElement>('#z3')!;
    z3.value = '0.70';
    z3.dispatchEvent(new Event('input', { bubbles: true }));
    expect(app.store.snapshot().z0[3]).toBeCloseTo(0.7, 12);

    app.store.update((v) => {
      const z0 = [...v.z0] as unknown as typeof v.z0;
      (z0 as unknown as number[])[1] = -1.25;
      return { ...v, z0 };
    });
    expect(root.querySelector('#z1_v')!.textContent).toBe('-1.25');
  });

  it('zoom buttons move the viewport, not the slice (no recompute key change)', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = makeApp();
    mountUI(root, app, document.createElement('canvas'));

    const magBefore = app.store.snapshot().mag;
    root.querySelector<HTMLButtonElement>('#zoomIn')!.click();
    expect(app.store.snapshot().uvHalfWidth[0]).toBeCloseTo(0.25, 12);
    expect(app.store.snapshot().mag).toBe(magBefore);

    root.querySelector<HTMLButtonElement>('#magIn')!.click();
    expect(app.store.snapshot().mag).toBeCloseTo(magBefore / 2, 12);
  });

  it('the inspector panel toggles with lock state', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const app = makeApp();
    mountUI(root, app, document.createElement('canvas'));

    const panel = root.querySelector<HTMLDivElement>('.inspector')!;
    expect(panel.hidden).toBe(true);
    app.input.lock({ s: 0.5, t: 0.5 });
    expect(panel.hidden).toBe(false);
    panel.querySelector<HTMLButtonElement>('.unlock')!.click();
    expect(panel.hidden).toBe(true);
  });
});
