import type { ViewState } from './view_state.js';
import type { Vec8 } from '@/math/types.js';

/**
 * Set component k of `z0` to `value`, returning a fresh ViewState.
 * Sliders write through directly: there is no debouncing here — the
 * scheduler in M5 handles the load by switching to Preview tier on
 * input.
 */
export function setSlider(v: ViewState, k: number, value: number): ViewState {
  if (k < 0 || k > 7) throw new RangeError(`slider index ${k} out of range`);
  const z0 = [...v.z0] as unknown as [number, number, number, number,
                                      number, number, number, number];
  z0[k] = value;
  return { ...v, z0 };
}

/** Set every slider in one call (used by lookup). */
export function setAllSliders(v: ViewState, z: Vec8): ViewState {
  return { ...v, z0: z };
}
