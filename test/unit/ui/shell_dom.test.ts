// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { progressLabel } from '@/ui/LoadingIndicator.js';
import { installKeybindings } from '@/ui/Keybindings.js';
import { buildKeymap } from '@/ui/keymap.js';
import { RenderParamsStore } from '@/ui/render_params.js';
import { DEFAULT_RENDER_PARAMS } from '@/render/types.js';
import type { App } from '@/app/app.js';

// The loading-label logic is pure and runs without a DOM.
describe('progressLabel: pure loader logic', () => {
  it('is idle with no in-flight jobs', () => {
    expect(progressLabel(0, false)).toEqual({ busy: false, label: '' });
  });

  it('reports a singular tile count', () => {
    expect(progressLabel(1, false).label).toMatch(/Computing 1 tile…/);
  });

  it('appends a degradation hint when over budget', () => {
    expect(progressLabel(3, true).label).toMatch(/reducing quality/);
  });
});

describe('RenderParamsStore: render-only reactive store', () => {
  it('notifies subscribers and fires onRebind on every change', () => {
    const rebinds: string[] = [];
    const store = new RenderParamsStore(DEFAULT_RENDER_PARAMS,
      (p) => rebinds.push(p.palette));
    const seen: string[] = [];
    store.subscribe((p) => seen.push(p.palette));       // fires immediately
    store.update((p) => ({ ...p, palette: 'magma' }));
    expect(seen).toEqual(['viridis', 'magma']);
    expect(rebinds).toEqual(['magma']);
    expect(store.snapshot().palette).toBe('magma');
  });
});

describe('keybindings install/teardown (DOM)', () => {
  function stubApp(counts: { zoom: number; unlock: number }): App {
    return {
      store: {
        snapshot: () => ({ locked: false, uvCentre: [0.5, 0.5] }),
        setView: () => {},
        update: () => { counts.zoom++; },
        subscribe: () => () => {},
      },
      input: { zoom: () => {}, lock: () => {}, unlock: () => { counts.unlock++; } },
    } as unknown as App;
  }

  it('install returns a disposer that removes the listener', () => {
    const counts = { zoom: 0, unlock: 0 };
    const dispose = installKeybindings(
      window, stubApp(counts), buildKeymap([['=', 'zoomIn']]),
      { getHistory: () => { throw new Error('unused'); }, setHistory: () => {} },
    );
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '=' }));
    expect(counts.zoom).toBe(1);
    dispose();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '=' }));
    expect(counts.zoom).toBe(1);     // listener removed
  });

  it('keystrokes inside editable elements are ignored', () => {
    const counts = { zoom: 0, unlock: 0 };
    const dispose = installKeybindings(
      window, stubApp(counts), buildKeymap([['escape', 'unlock']]),
      { getHistory: () => { throw new Error('unused'); }, setHistory: () => {} },
    );
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(counts.unlock).toBe(0);   // typing field not hijacked
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(counts.unlock).toBe(1);
    dispose();
    input.remove();
  });
});
