import type { Timeline, TimelineTrack } from './types.js';
import type { ViewState } from '@/interact/view_state.js';
import { ease } from './easing.js';

/**
 * Get/set field by dotted path. Supports `field`, `field.subfield`,
 * `field[3]`, `field.sub[2]`, etc. We don't try to be fully general —
 * `ViewState` paths are bounded.
 */
export function getByPath(obj: any, path: string): any {
  return splitPath(path).reduce((cur, key) => cur?.[key], obj);
}

export function setByPath(obj: any, path: string, value: any): any {
  const segments = splitPath(path);
  // Walk to the parent of the target, copying containers on the way so
  // shared sub-objects are never mutated in place.
  let cur = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const k = segments[i]!;
    if (Array.isArray(cur[k])) cur[k] = [...cur[k]];
    else if (cur[k] && typeof cur[k] === 'object') cur[k] = { ...cur[k] };
    cur = cur[k];
  }
  const last = segments[segments.length - 1]!;
  cur[last] = value;
  return obj;
}

function splitPath(path: string): (string | number)[] {
  const out: (string | number)[] = [];
  for (const part of path.split('.')) {
    const m = part.match(/^([^[]+)((?:\[\d+\])*)$/);
    if (!m) throw new Error(`bad path segment: ${part}`);
    out.push(m[1]!);
    for (const idx of (m[2] ?? '').match(/\[(\d+)\]/g) ?? []) {
      out.push(Number(idx.slice(1, -1)));
    }
  }
  return out;
}

/**
 * Evaluate a single track at a given frame. Linear interpolation
 * between bracketing keyframes, with the easing function applied to
 * the position parameter.
 */
export function evaluateTrack<T>(
  track: TimelineTrack<T>, frame: number, base: T,
): T {
  const ks = track.keyframes;
  if (ks.length === 0) return base;
  if (frame < ks[0]!.frame) return base;
  if (frame >= ks[ks.length - 1]!.frame) return ks[ks.length - 1]!.value;

  let i = 0;
  while (i < ks.length - 1 && ks[i + 1]!.frame <= frame) i++;
  const a = ks[i]!, b = ks[i + 1]!;
  const t01 = (frame - a.frame) / (b.frame - a.frame);
  const w = ease(a.easing, t01);
  return interpolate(a.value, b.value, w);
}

function interpolate<T>(a: T, b: T, w: number): T {
  if (typeof a === 'number' && typeof b === 'number') {
    return (a * (1 - w) + b * w) as T;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.map((x, i) => interpolate(x, b[i], w)) as T;
  }
  // String / boolean / object: snap at midpoint (step semantics).
  return w < 0.5 ? a : b;
}

/**
 * Build the per-frame `ViewState` for the given frame index by applying
 * every track on top of the base.
 */
export function evaluateTimeline(
  tl: Timeline, frame: number,
): ViewState {
  const view = structuredClone(tl.base);
  for (const tr of tl.tracks) {
    const base = getByPath(view, tr.path);
    setByPath(view, tr.path, evaluateTrack(tr, frame, base));
  }
  return view;
}
