// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mountDebugHud, type DebugHudDeps } from '@/devhud/mount.js';
import { extendCapture } from '@/devhud/capture.js';
import { defaultViewState } from '@/interact/view_state.js';
import type { App } from '@/app/app.js';

// happy-dom smoke mount, mirroring G12's shell_dom.test.ts. The HUD only
// reads store.snapshot()/subscribe() and its injected deps — minimal fakes.
const fakeApp = (): App => {
  const view = { qualityTier: 'balanced' };
  return {
    store: {
      snapshot: () => view,
      subscribe: (f: (v: unknown) => void) => { f(view); return () => {}; },
    },
  } as unknown as App;
};
const deps = (over: Partial<DebugHudDeps> = {}): DebugHudDeps => ({
  perf: {
    snapshot: () => ({
      frames: 1, cpuMeanMs: 8, cpuP95Ms: 9, gpuP95Ms: {},
      gpuTimingAvailable: false, budget: 'ok', overFraction: 0,
    }),
    recommend: () => ({ dispatchCapScale: 1, recommendTier: null, reason: 'ok' }),
  } as any,
  sink: { records: () => [] } as any,
  tileFlags: () => new Map(),
  inspector: () => null,
  capture: () => null,
  raf: () => 0,            // no real animation frame in the test
  caf: () => {},
  ...over,
});

describe('mountDebugHud (happy-dom smoke)', () => {
  it('mounts hidden and returns a disposer', () => {
    const root = document.createElement('div');
    const off = mountDebugHud(root, fakeApp(), deps());
    expect(root.querySelector('.devhud')!.hasAttribute('hidden')).toBe(true);
    off();
    expect(root.querySelector('.devhud')).toBeNull();
  });

  it('toggles visible on the `~` key and renders the perf tab', () => {
    const root = document.createElement('div');
    const off = mountDebugHud(root, fakeApp(), deps());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '~' }));
    expect(root.querySelector('.devhud')!.hasAttribute('hidden')).toBe(false);
    expect(root.querySelector('.devhud-perf')!.textContent).toMatch(/cpu/);
    off();
  });

  it('the disposer removes the `~` listener (no zombie toggles)', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const off = mountDebugHud(root, fakeApp(), deps());
    off();
    // After dispose the root is emptied and re-dispatching must not throw
    // or resurrect the drawer.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '~' }));
    expect(root.querySelector('.devhud')).toBeNull();
    root.remove();
  });

  it("selecting the capture tab renders G18's own capture panel", () => {
    const root = document.createElement('div');
    const off = mountDebugHud(root, fakeApp(), deps({ capture: () => null }));
    root.querySelector<HTMLButtonElement>('button[data-tab="capture"]')!.click();
    root.querySelector<HTMLButtonElement>('button[data-tab="perf"]')!.click();
    root.querySelector<HTMLButtonElement>('button[data-tab="capture"]')!.click();
    expect(root.querySelector('.devhud-capture')!.textContent).toMatch(/no captured frame/);
    off();
  });

  it('the capture button takes a persistent snapshot with a download link', () => {
    let takes = 0;
    const fakeCap = extendCapture(
      { version: 2, N: 16, M: 8, uniforms: {}, tile: {}, chart: {} } as any,
      defaultViewState(), { E: 1, patternId: 0 });
    const root = document.createElement('div');
    const off = mountDebugHud(root, fakeApp(), deps({
      capture: () => { takes++; return fakeCap; },
    }));
    root.querySelector<HTMLButtonElement>('button[data-tab="capture"]')!.click();
    const take = root.querySelector<HTMLButtonElement>('.devhud-capture-take')!;
    expect(take.disabled).toBe(false);
    expect(takes).toBe(0);                       // never called on render
    take.click();
    expect(takes).toBe(1);                       // called exactly on click
    expect(root.querySelector('.devhud-capture')!.textContent).toMatch(/16×8/);
    const dl = root.querySelector<HTMLAnchorElement>('.devhud-capture-download')!;
    expect(dl.download).toMatch(/principia-capture-/);
    expect(dl.href).toMatch(/^data:application\/json,/);
    // The snapshot persists across tab switches (stored, not re-derived).
    root.querySelector<HTMLButtonElement>('button[data-tab="perf"]')!.click();
    root.querySelector<HTMLButtonElement>('button[data-tab="capture"]')!.click();
    expect(takes).toBe(1);
    expect(root.querySelector('.devhud-capture')!.textContent).toMatch(/16×8/);
    off();
  });

  it('the errors tab renders counts from the sink and tile flags', () => {
    const root = document.createElement('div');
    const off = mountDebugHud(root, fakeApp(), deps({
      tileFlags: () => new Map([['1/0/0', 1 << 8]]),          // SIM_FAILED
    }));
    root.querySelector<HTMLButtonElement>('button[data-tab="errors"]')!.click();
    const el = root.querySelector('.devhud-errors')!;
    expect(el.textContent).toMatch(/failed tiles 1/);
    expect(root.querySelector('.devhud-tile-failure')!.textContent).toMatch(/sim failed/);
    off();
  });

  it('the validation tab reports the no-lock state', () => {
    const root = document.createElement('div');
    const off = mountDebugHud(root, fakeApp(), deps());
    root.querySelector<HTMLButtonElement>('button[data-tab="validation"]')!.click();
    expect(root.querySelector('.devhud-validation')!.textContent)
      .toMatch(/no locked inspector result/);
    off();
  });
});
