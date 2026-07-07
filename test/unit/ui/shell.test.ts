import { describe, it, expect } from 'vitest';
import {
  initHistory, pushHistory, undo, redo, canUndo, canRedo, isComputeChange,
} from '@/ui/history.js';
import {
  parseChord, chordToString, eventToChord, buildKeymap, lookupChord, rebind,
  DEFAULT_BINDINGS,
} from '@/ui/keymap.js';
import {
  captureView, applyPreset, savePreset, PresetStore, BUILTIN_PRESETS,
} from '@/ui/presets.js';
import { defaultViewState } from '@/interact/view_state.js';
import type { ViewState } from '@/interact/view_state.js';

const base = (): ViewState => defaultViewState();

describe('history reducer: push / undo / redo', () => {
  it('a compute change pushes the prior present onto the past', () => {
    let h = initHistory(base());
    const next = { ...base(), mag: 5 };            // mag is in the cache key
    h = pushHistory(h, next);
    expect(canUndo(h)).toBe(true);
    expect(h.present.mag).toBe(5);
    expect(h.past).toHaveLength(1);
  });

  it('undo restores the previous present and stocks the redo future', () => {
    let h = initHistory(base());
    h = pushHistory(h, { ...base(), mag: 5 });
    h = undo(h);
    expect(h.present.mag).toBe(base().mag);
    expect(canRedo(h)).toBe(true);
  });

  it('redo re-applies the undone present', () => {
    let h = initHistory(base());
    h = pushHistory(h, { ...base(), mag: 5 });
    h = redo(undo(h));
    expect(h.present.mag).toBe(5);
    expect(canRedo(h)).toBe(false);
  });

  it('a new edit after undo truncates the redo future (fork)', () => {
    let h = initHistory(base());
    h = pushHistory(h, { ...base(), mag: 5 });
    h = undo(h);
    expect(canRedo(h)).toBe(true);
    h = pushHistory(h, { ...base(), mag: 7 });      // forks
    expect(canRedo(h)).toBe(false);
    expect(h.present.mag).toBe(7);
  });

  it('the ring evicts the oldest past beyond cap', () => {
    let h = initHistory(base(), 2);
    h = pushHistory(h, { ...base(), mag: 1 });
    h = pushHistory(h, { ...base(), mag: 2 });
    h = pushHistory(h, { ...base(), mag: 3 });
    expect(h.past).toHaveLength(2);
    // Oldest (the original present) was evicted; earliest reachable is mag:1.
    expect(h.past[0]!.mag).toBe(1);
  });

  it('undo/redo on an empty stack are no-ops', () => {
    const h = initHistory(base());
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });
});

describe('history: render-only changes never push', () => {
  it('isComputeChange is false for an identical view', () => {
    const v = base();
    expect(isComputeChange(v, { ...v })).toBe(false);
  });

  it('a non-cache-key, non-lock field (zoom UI quantity) does not push', () => {
    // `zoom` is a pure UI quantity (M8) — not in viewStateToCacheKey.
    let h = initHistory(base());
    const before = h.present;
    h = pushHistory(h, { ...base(), zoom: 3 });
    expect(canUndo(h)).toBe(false);           // present replaced, nothing pushed
    expect(h.present.zoom).toBe(3);
    expect(h.present).not.toBe(before);
  });

  it('chartType (cache-key) DOES push, proving the gate is real', () => {
    let h = initHistory(base());
    h = pushHistory(h, { ...base(), chartType: 'lz_e' });
    expect(canUndo(h)).toBe(true);
  });

  it('a tilt change pushes even though tilt is not all in the cache key', () => {
    let h = initHistory(base());
    h = pushHistory(h, { ...base(), tilt1: 0.5 });
    expect(canUndo(h)).toBe(true);
  });

  it('a viewport window change (uvHalfWidth) pushes — zoom is undoable', () => {
    let h = initHistory(base());
    h = pushHistory(h, { ...base(), uvHalfWidth: [0.25, 0.25] });
    expect(canUndo(h)).toBe(true);
  });
});

describe('keymap reducer: parse / lookup / rebind', () => {
  it('parseChord normalises modifier order and case', () => {
    expect(parseChord('Shift+Ctrl+Z')).toBe(parseChord('ctrl+shift+z'));
    expect(parseChord('Ctrl+Z')).toBe('ctrl+z');
  });

  it('chordToString is the inverse of a parsed chord', () => {
    expect(chordToString({ key: 'z', ctrl: true, shift: false, alt: false, meta: false }))
      .toBe('ctrl+z');
  });

  it('eventToChord reads modifiers off an event-like object', () => {
    expect(eventToChord({ key: 'Z', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false }))
      .toBe('ctrl+shift+z');
  });

  it('the default keymap resolves Ctrl+Z to undo and Ctrl+Shift+Z to redo', () => {
    const m = buildKeymap();
    expect(lookupChord(m, parseChord('ctrl+z'))).toBe('undo');
    expect(lookupChord(m, parseChord('ctrl+shift+z'))).toBe('redo');
  });

  it('an unbound chord returns undefined (fall-through)', () => {
    expect(lookupChord(buildKeymap(), parseChord('ctrl+q'))).toBeUndefined();
  });

  it('rebind returns a NEW map and leaves the original intact', () => {
    const m = buildKeymap([['ctrl+z', 'undo']]);
    const m2 = rebind(m, 'ctrl+r', 'redo');
    expect(lookupChord(m2, parseChord('ctrl+r'))).toBe('redo');
    expect(lookupChord(m, parseChord('ctrl+r'))).toBeUndefined();   // original unchanged
  });

  it('rebind refuses to shadow an existing chord without override', () => {
    const m = buildKeymap([['ctrl+z', 'undo']]);
    expect(() => rebind(m, 'ctrl+z', 'redo')).toThrow();
    expect(lookupChord(rebind(m, 'ctrl+z', 'redo', true), parseChord('ctrl+z'))).toBe('redo');
  });

  it('parseChord rejects a modifier-only spec', () => {
    expect(() => parseChord('ctrl+shift')).toThrow();
  });

  it('every default binding parses and resolves to an action', () => {
    const m = buildKeymap();
    for (const [spec, action] of DEFAULT_BINDINGS) {
      expect(lookupChord(m, parseChord(spec))).toBe(action);
    }
  });
});

describe('preset store: save / apply round-trip', () => {
  it('captureView → applyPreset round-trips the captured fields', () => {
    const src = {
      ...base(), chartType: 'shape_sphere', mag: 4.2,
      qualityTier: 'research' as const,
    };
    const preset = savePreset('p1', 'P1', src);
    const applied = applyPreset(base(), preset);
    expect(applied.chartType).toBe('shape_sphere');
    expect(applied.mag).toBe(4.2);
    expect(applied.qualityTier).toBe('research');
  });

  it('applyPreset clears the lock and refreshes the timestamp', () => {
    const preset = savePreset('p1', 'P1', base());
    const locked = { ...base(), locked: true };
    const applied = applyPreset(locked, preset);
    expect(applied.locked).toBe(false);
    expect(typeof applied.timestamp).toBe('string');
  });

  it('a preset captures no render-only or transient fields', () => {
    const captured = captureView(base()) as Record<string, unknown>;
    // RenderParams keys must never appear in a captured preset...
    for (const k of ['colourMode', 'palette', 'cvdMode', 'brightnessMode']) {
      expect(k in captured, k).toBe(false);
    }
    // ...nor lock state or the viewport window (a preset is a chart, not
    // a camera position).
    for (const k of ['locked', 'lockedPhysical', 'uvCentre', 'uvHalfWidth', 'timestamp']) {
      expect(k in captured, k).toBe(false);
    }
  });

  it('PresetStore.save returns a new store and never mutates builtins', () => {
    const store = new PresetStore();
    const next = store.save(savePreset('user_a', 'Mine', base()));
    expect(next.get('user_a')?.builtin).toBe(false);
    expect(store.get('user_a')).toBeUndefined();        // original unchanged
    expect(next.get('home')?.builtin).toBe(true);       // builtin preserved
  });

  it('saving over a builtin id is rejected', () => {
    const store = new PresetStore();
    expect(() => store.save(savePreset('home', 'Hijack', base()))).toThrow();
  });

  it('removing a builtin is rejected; removing a user preset works', () => {
    let store = new PresetStore().save(savePreset('user_a', 'Mine', base()));
    expect(() => store.remove(BUILTIN_PRESETS[0]!.id)).toThrow();
    store = store.remove('user_a');
    expect(store.get('user_a')).toBeUndefined();
  });
});
