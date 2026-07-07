import type { CvdMode } from '@/render/types.js';
import { cvdLabel } from './cvd_control.js';

/** Typed UI changes worth announcing to a screen reader. */
export type Announcement =
  | { kind: 'lock'; locked: boolean }
  | { kind: 'chart'; chart: string }
  | { kind: 'zoom'; mag: number }
  | { kind: 'cvd'; mode: CvdMode }
  | { kind: 'contrast'; on: boolean }
  | { kind: 'font'; scale: number };

/**
 * Build the polite-region text. Pure and total; the `never` arm makes a new
 * Announcement kind a compile error until it has a phrasing.
 */
export function announce(a: Announcement): string {
  switch (a.kind) {
    case 'lock':
      return a.locked ? 'Affine frame locked.' : 'Affine frame unlocked.';
    case 'chart':
      return `Chart changed to ${a.chart}.`;
    case 'zoom':
      return `Zoom ${a.mag.toPrecision(3)}.`;
    case 'cvd':
      return a.mode === 'none'
        ? 'Colour-vision simulation off.'
        : `Colour-vision simulation: ${cvdLabel(a.mode)}.`;
    case 'contrast':
      return a.on ? 'High-contrast theme on.' : 'High-contrast theme off.';
    case 'font':
      return `Font size ${Math.round(a.scale * 100)} percent.`;
    default: {
      const _exhaustive: never = a;
      return _exhaustive;
    }
  }
}

/** Minimal interface to the G2 Store (subscribe/snapshot) we need here. */
interface StoreLike<V> {
  snapshot(): V;
  subscribe(cb: (v: V) => void): () => void;
}
interface ViewLike { locked: boolean; chartType: string; mag: number }

/**
 * Mounts a polite live region and speaks ViewState-derived changes. DOM-thin:
 * all phrasing comes from announce(); only the diff + textContent write live
 * here. start() returns an unsubscribe.
 */
export class LiveRegion<V extends ViewLike> {
  private prev: V;
  constructor(
    private readonly node: { textContent: string | null },
    private readonly store: StoreLike<V>,
  ) {
    this.prev = store.snapshot();
  }

  start(): () => void {
    return this.store.subscribe(v => {
      const msgs: string[] = [];
      if (v.locked !== this.prev.locked) msgs.push(announce({ kind: 'lock', locked: v.locked }));
      if (v.chartType !== this.prev.chartType) msgs.push(announce({ kind: 'chart', chart: v.chartType }));
      if (v.mag !== this.prev.mag) msgs.push(announce({ kind: 'zoom', mag: v.mag }));
      if (msgs.length > 0) this.node.textContent = msgs.join(' ');
      this.prev = v;
    });
  }

  /** Imperative announce for non-ViewState changes (CVD, contrast, font). */
  say(a: Announcement): void {
    this.node.textContent = announce(a);
  }
}
