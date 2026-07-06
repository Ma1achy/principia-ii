import type { EasingName } from './types.js';

export const easings: Record<EasingName, (t: number) => number> = {
  linear:      (t) => t,
  ease_in:     (t) => t * t,
  ease_out:    (t) => 1 - (1 - t) * (1 - t),
  ease_in_out: (t) => 3 * t * t - 2 * t * t * t,
  hold:        () => 0,
  log:         (t) => Math.log(1 + 9 * t) / Math.log(10),
  step:        (t) => (t < 1 ? 0 : 1),
};

/** Apply easing and clamp to [0, 1]. */
export function ease(name: EasingName, t: number): number {
  const e = easings[name](t);
  return Math.max(0, Math.min(1, e));
}
