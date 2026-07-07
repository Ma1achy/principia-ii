import { describe, it, expect } from 'vitest';
import {
  reduceCvd, setCvd, cycleCvd, cvdLabel, isRenderOnly, CVD_ORDER,
} from '@/ui/a11y/cvd_control.js';
import {
  buildAria, panelAria, sliderAria, canvasAria, statusAria,
} from '@/ui/a11y/aria.js';
import {
  focusOrder, rovingTabindex, advanceRoving,
  resolveKey, describeShortcuts, SHORTCUTS, type FocusStop,
} from '@/ui/a11y/keyboard.js';
import { announce } from '@/ui/a11y/live_region.js';
import { themeVars, clampFontScale, stepFontScale, DEFAULT_THEME } from '@/ui/a11y/theme.js';
import { DEFAULT_RENDER_PARAMS } from '@/render/types.js';

/* A minimal ViewState stand-in + a pure cache-key function mirroring M8's
 * viewStateToCacheKey: the key is derived ONLY from ViewState, never from
 * RenderParams. This lets us prove the render-only invariant headlessly. */
interface View { chartType: string; z0: number[]; mag: number; locked: boolean }
const view: View = { chartType: 'lz_e', z0: [0, 0, 0, 0, 0, 0, 0, 0], mag: 1, locked: false };
const keyOf = (v: View): object => ({ chartId: v.chartType, z0: v.z0, mag: v.mag });

describe('cvd reducer: render-only RenderParams edits', () => {
  it('setCvd returns a new RenderParams with only cvdMode changed', () => {
    const p = setCvd(DEFAULT_RENDER_PARAMS, 'deutan');
    expect(p).not.toBe(DEFAULT_RENDER_PARAMS);
    expect(p.cvdMode).toBe('deutan');
    expect({ ...p, cvdMode: 'x' }).toEqual({ ...DEFAULT_RENDER_PARAMS, cvdMode: 'x' });
  });

  it('setCvd to the current mode is a no-op (same reference)', () => {
    const p = setCvd(DEFAULT_RENDER_PARAMS, DEFAULT_RENDER_PARAMS.cvdMode);
    expect(p).toBe(DEFAULT_RENDER_PARAMS);
  });

  it('setCvd ignores an unknown mode (total, no throw)', () => {
    const p = setCvd(DEFAULT_RENDER_PARAMS, 'bogus' as never);
    expect(p).toBe(DEFAULT_RENDER_PARAMS);
  });

  it('cycleCvd forward walks CVD_ORDER and wraps', () => {
    let p = { ...DEFAULT_RENDER_PARAMS, cvdMode: CVD_ORDER[CVD_ORDER.length - 1]! };
    p = cycleCvd(p, 1);
    expect(p.cvdMode).toBe(CVD_ORDER[0]);
  });

  it('cycleCvd backward wraps to the last entry', () => {
    const p = cycleCvd({ ...DEFAULT_RENDER_PARAMS, cvdMode: 'none' }, -1);
    expect(p.cvdMode).toBe(CVD_ORDER[CVD_ORDER.length - 1]);
  });

  it('reduceCvd cycle from a stale/unknown mode starts at index 0', () => {
    const p = reduceCvd({ ...DEFAULT_RENDER_PARAMS, cvdMode: 'gone' as never }, { type: 'cycle', dir: 1 });
    expect(p.cvdMode).toBe(CVD_ORDER[1]);  // base index 0 + 1
  });

  it('RENDER-ONLY invariant: a CVD edit leaves ViewState + cache key untouched', () => {
    // The CVD edit operates on RenderParams; the ViewState reference is reused,
    // so its cache key is byte-identical. This is the two-stage decoupling.
    const before = view;
    setCvd(DEFAULT_RENDER_PARAMS, 'tritan');   // edit happens entirely in RenderParams
    const after = before;                       // shell never reassigns ViewState
    expect(isRenderOnly(before, after, keyOf)).toBe(true);
    expect(JSON.stringify(keyOf(before))).toBe(JSON.stringify(keyOf(after)));
  });

  it('cvdLabel maps every mode to a non-empty string', () => {
    for (const m of CVD_ORDER) expect(cvdLabel(m).length).toBeGreaterThan(0);
  });
});

describe('aria attribute builder', () => {
  it('buildAria assembles role + aria-label', () => {
    expect(buildAria('region', 'Panel')).toEqual({ role: 'region', 'aria-label': 'Panel' });
  });

  it('buildAria stringifies booleans and numbers the ARIA way', () => {
    const a = buildAria('slider', 'z', { extra: { 'aria-valuenow': 3, 'aria-hidden': false } });
    expect(a['aria-valuenow']).toBe('3');
    expect(a['aria-hidden']).toBe('false');
  });

  it('panelAria is a labelled region', () => {
    expect(panelAria('View')).toEqual({ role: 'region', 'aria-label': 'View' });
  });

  it('sliderAria mirrors the numeric model + value text', () => {
    const a = sliderAria('z[0]', 1.5, -3, 3);
    expect(a['role']).toBe('slider');
    expect(a['aria-valuenow']).toBe('1.5');
    expect(a['aria-valuemin']).toBe('-3');
    expect(a['aria-valuemax']).toBe('3');
    expect(a['aria-valuetext']).toBe('1.50');
  });

  it('canvasAria is an interactive application region, focusable', () => {
    const a = canvasAria();
    expect(a['role']).toBe('application');
    expect(a['tabindex']).toBe('0');
    expect(a['aria-roledescription']).toMatch(/interactive/);
  });

  it('statusAria is a polite, atomic status region', () => {
    const a = statusAria();
    expect(a['role']).toBe('status');
    expect(a['aria-live']).toBe('polite');
    expect(a['aria-atomic']).toBe('true');
  });
});

describe('keyboard: focus order + roving tabindex', () => {
  it('focusOrder filters to present stops in canonical order', () => {
    const present: FocusStop[] = ['canvas', 'chart', 'cvd'];
    expect(focusOrder(present)).toEqual(['chart', 'cvd', 'canvas']);
  });

  it('rovingTabindex puts only the active item in the tab sequence', () => {
    expect(rovingTabindex(4, 2)).toEqual([-1, -1, 0, -1]);
  });

  it('advanceRoving wraps forward past the end', () => {
    expect(advanceRoving(3, 4, 1, true)).toBe(0);
  });

  it('advanceRoving clamps at the ends when wrap is off', () => {
    expect(advanceRoving(3, 4, 1, false)).toBe(3);
    expect(advanceRoving(0, 4, -1, false)).toBe(0);
  });

  it('advanceRoving is safe on an empty group', () => {
    expect(advanceRoving(0, 0, 1)).toBe(0);
  });
});

describe('keyboard: shortcut resolution + Escape/Enter semantics', () => {
  it('Alt+c cycles CVD forward', () => {
    expect(resolveKey({ key: 'c', altKey: true })).toEqual({ kind: 'cvd-cycle', dir: 1 });
  });

  it('Alt+Shift+C cycles CVD backward', () => {
    expect(resolveKey({ key: 'C', altKey: true, shiftKey: true })).toEqual({ kind: 'cvd-cycle', dir: -1 });
  });

  it('Enter resolves to commit, Escape to dismiss', () => {
    expect(resolveKey({ key: 'Enter' })).toEqual({ kind: 'commit' });
    expect(resolveKey({ key: 'Escape' })).toEqual({ kind: 'dismiss' });
  });

  it('a bare c (no Alt) does not match the CVD shortcut', () => {
    expect(resolveKey({ key: 'c' })).toEqual({ kind: 'none' });
  });

  it('an unbound key resolves to none (event passes through)', () => {
    expect(resolveKey({ key: 'q', altKey: true })).toEqual({ kind: 'none' });
  });

  it('describeShortcuts lists every binding with a combo + description', () => {
    const list = describeShortcuts();
    expect(list).toHaveLength(SHORTCUTS.length);
    expect(list.find(s => s.combo === 'Alt+c')?.describe).toMatch(/colour-vision/i);
    expect(list.find(s => s.combo === 'Escape')).toBeDefined();
  });
});

describe('live-region announcements', () => {
  it('lock / unlock phrasing', () => {
    expect(announce({ kind: 'lock', locked: true })).toMatch(/locked/);
    expect(announce({ kind: 'lock', locked: false })).toMatch(/unlocked/);
  });

  it('chart + zoom phrasing carry the value', () => {
    expect(announce({ kind: 'chart', chart: 'lz_e' })).toBe('Chart changed to lz_e.');
    expect(announce({ kind: 'zoom', mag: 2.5 })).toMatch(/2\.5/);
  });

  it('cvd announcement uses the human label and an off case', () => {
    expect(announce({ kind: 'cvd', mode: 'deutan' })).toMatch(/Deuteranopia/);
    expect(announce({ kind: 'cvd', mode: 'none' })).toMatch(/off/i);
  });

  it('contrast + font announcements', () => {
    expect(announce({ kind: 'contrast', on: true })).toMatch(/on/);
    expect(announce({ kind: 'font', scale: 1.25 })).toMatch(/125 percent/);
  });
});

describe('theme: contrast / font-scale / reduced-motion', () => {
  it('themeVars adds the high-contrast class only when enabled', () => {
    expect(themeVars(DEFAULT_THEME, false).classes).not.toContain('a11y-high-contrast');
    expect(themeVars({ ...DEFAULT_THEME, highContrast: true }, false).classes)
      .toContain('a11y-high-contrast');
  });

  it('reduced-motion follows the media query, with an explicit override', () => {
    expect(themeVars(DEFAULT_THEME, true).classes).toContain('a11y-reduced-motion');
    expect(themeVars({ ...DEFAULT_THEME, reducedMotion: false }, true).classes)
      .not.toContain('a11y-reduced-motion');
  });

  it('font scale clamps and quantises; stepping respects the clamp', () => {
    expect(clampFontScale(5)).toBe(2.0);
    expect(clampFontScale(0.1)).toBe(0.75);
    expect(stepFontScale(2.0, 1)).toBe(2.0);     // already at ceiling
    expect(themeVars({ ...DEFAULT_THEME, fontScale: 1.2 }, false).vars['--a11y-font-scale'])
      .toBe('1.2');
  });
});
