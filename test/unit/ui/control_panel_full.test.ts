// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { App } from '@/app/app.js';
import type { GpuDispatcher } from '@/app/types.js';
import type { InspectorResult } from '@/inspector/types.js';
import { mountControlPanel } from '@/ui/ControlPanel.js';
import { RenderParamsStore } from '@/ui/render_params.js';
import { stubReduction } from '../../helpers/stub_reduction.js';

function makeApp(): App {
  const dispatcher: GpuDispatcher = {
    dispatchTile: async (id) => stubReduction(id),
    cancel: () => {},
    render: () => {},
    inspect: async () => ({} as InspectorResult),
  };
  return new App(dispatcher, { now: () => 0, schedule: () => 0, cancel: () => {} });
}

function mount(): { root: HTMLElement; app: App; render: RenderParamsStore } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const app = makeApp();
  const render = new RenderParamsStore();
  mountControlPanel(root, app, render);
  return { root, app, render };
}

function fire(el: HTMLElement, type: 'input' | 'change'): void {
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

describe('ControlPanel — full ViewState + RenderParams exposure (Stage 1)', () => {
  it('exposes a control for every ViewState + RenderParams field', () => {
    const { root } = mount();
    // The "no hidden settings" gate: each of these must be reachable in the
    // production panel, not a dev harness.
    const ids = [
      // Slice & tilt
      '#tilt1', '#tilt2', '#tilt1Target', '#tilt2Target', '#rotation', '#mag_v',
      // Integration
      '#integrator', '#THorizon', '#dtMacro', '#NMax', '#checkpoints',
      // Quality & tiles
      '#quality', '#samplesPerAxis', '#maxDepth', '#ensembleCount',
      // Render (group-3)
      '#colourMode', '#brightness', '#combiner', '#palette',
      '#vmfKappa', '#vmfChroma', '#vmfLightness', '#overlay', '#overlayStrength', '#cvd',
      // Diagnostics (render-only debug recolour)
      '#debugMode',
    ];
    for (const id of ids) expect(root.querySelector(id), `missing ${id}`).not.toBeNull();
    // z0[0..7]
    for (let k = 0; k < 8; k++) expect(root.querySelector(`#z${k}`)).not.toBeNull();
  });

  it('offers all 25 colour modes (incl. none) and 6/3 brightness/combiner modes', () => {
    const { root } = mount();
    expect(root.querySelectorAll('#colourMode option')).toHaveLength(25);
    expect(root.querySelector('#colourMode option[value="none"]')).not.toBeNull();
    expect(root.querySelectorAll('#brightness option')).toHaveLength(6);
    expect(root.querySelector('#brightness option[value="ftle"]')).not.toBeNull();
    expect(root.querySelectorAll('#combiner option')).toHaveLength(3);
  });

  it('tilt2 angle + target route through setTilt (basis recomputed, not accumulated)', () => {
    const { root, app } = mount();
    const q2Before = [...app.store.snapshot().q2];

    const tilt2 = root.querySelector<HTMLInputElement>('#tilt2')!;
    tilt2.value = '0.5';
    fire(tilt2, 'input');
    expect(app.store.snapshot().tilt2).toBeCloseTo(0.5, 12);
    expect([...app.store.snapshot().q2]).not.toEqual(q2Before);

    const t2t = root.querySelector<HTMLSelectElement>('#tilt2Target')!;
    t2t.value = '5';
    fire(t2t, 'change');
    expect(app.store.snapshot().tilt2Target).toBe(5);
  });

  it('integration + quality number fields write through to ViewState', () => {
    const { root, app } = mount();
    const set = (id: string, val: string): void => {
      const el = root.querySelector<HTMLInputElement>(id)!;
      el.value = val; fire(el, 'input');
    };
    set('#THorizon', '120');
    set('#NMax', '32');
    set('#maxDepth', '14');
    set('#ensembleCount', '4');
    const v = app.store.snapshot();
    expect(v.THorizon).toBe(120);
    expect(v.NMax).toBe(32);
    expect(v.maxDepth).toBe(14);
    expect(v.ensembleCount).toBe(4);

    const integrator = root.querySelector<HTMLSelectElement>('#integrator')!;
    integrator.value = 'yoshida6'; fire(integrator, 'change');
    expect(app.store.snapshot().integrator).toBe('yoshida6');
  });

  it('render-mode changes hit the render store only — never the compute cache key', () => {
    const { root, app, render } = mount();
    const keyBefore = JSON.stringify(app.store.snapshot());   // whole ViewState
    const colour = root.querySelector<HTMLSelectElement>('#colourMode')!;
    colour.value = 'jacobi_angle';                            // any non-default mode
    fire(colour, 'change');
    expect(render.snapshot().colourMode).toBe('jacobi_angle');
    // ViewState (and therefore the cache key) is untouched by a render change.
    expect(JSON.stringify(app.store.snapshot())).toBe(keyBefore);
  });

  it('selecting the mixed-axis chart mounts the custom-chart axis editor', () => {
    const { root, app } = mount();
    expect(root.querySelectorAll('#chart option')).toHaveLength(9);
    expect(root.querySelector('#chart option[value="jacobi_position"]')).not.toBeNull();
    expect(root.querySelector('#chart option[value="jacobi_momentum"]')).not.toBeNull();
    app.store.update((v) => ({ ...v, chartType: 'mixed_axis' }));
    // Two axis editors with kind selects + range fields appear.
    expect(root.querySelectorAll('.axis-editor')).toHaveLength(2);
    const kind = root.querySelector<HTMLSelectElement>('.axis-editor [data-f=kind]')!;
    expect(kind.querySelectorAll('option')).toHaveLength(6);   // all axis kinds
    // Editing an axis writes a full AxisSpec into chartParams.
    kind.value = 'mass';
    kind.dispatchEvent(new Event('change', { bubbles: true }));
    const h = app.store.snapshot().chartParams['hAxis'] as { kind: string };
    expect(h.kind).toBe('mass');
  });

  it('the diagnostic selector is a render-only recolour — never a recompute', () => {
    const { root, app, render } = mount();
    const viewBefore = JSON.stringify(app.store.snapshot());
    expect(render.snapshot().debugMode).toBe(-1);           // off by default
    const dbg = root.querySelector<HTMLSelectElement>('#debugMode')!;
    dbg.value = '4';                                          // Energy-drift heat
    fire(dbg, 'change');
    expect(render.snapshot().debugMode).toBe(4);
    expect(JSON.stringify(app.store.snapshot())).toBe(viewBefore);
  });
});
