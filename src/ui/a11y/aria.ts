/** ARIA roles G13 assigns. Closed set keeps the presets honest. */
export type AriaRole =
  | 'application' | 'region' | 'group' | 'slider'
  | 'status' | 'button' | 'list' | 'listitem';

export interface AriaOptions {
  /** Extra aria-* / tabindex pairs, e.g. { 'aria-valuenow': '3' }. */
  extra?: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Pure: role + label + opts → a flat attribute map. Booleans are stringified
 * the ARIA way ('true'/'false'); numbers via String(). The map is what
 * applyAria writes; tests assert on the map directly.
 */
export function buildAria(
  role: AriaRole, label: string, opts: AriaOptions = {},
): Record<string, string> {
  const out: Record<string, string> = { role, 'aria-label': label };
  const extra = opts.extra ?? {};
  for (const [k, v] of Object.entries(extra)) {
    out[k] = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
  }
  return out;
}

/** DOM sink. Writes every entry of buildAria onto the element. */
export function applyAria(
  el: Element, role: AriaRole, label: string, opts: AriaOptions = {},
): void {
  const attrs = buildAria(role, label, opts);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
}

/* ---- Structural presets (pure) ---------------------------------------- */

/** A side panel: a labelled landmark region. */
export function panelAria(label: string): Record<string, string> {
  return buildAria('region', label);
}

/**
 * A range slider. ARIA mirrors the numeric model so a screen reader can read
 * the value without seeing the visual <span>.
 */
export function sliderAria(
  label: string, value: number, min: number, max: number,
): Record<string, string> {
  return buildAria('slider', label, {
    extra: {
      'aria-valuenow': value,
      'aria-valuemin': min,
      'aria-valuemax': max,
      'aria-valuetext': value.toFixed(2),
    },
  });
}

/**
 * The render canvas. It is an interactive `application` region (it captures
 * arrow keys for pan/tilt), so screen readers must pass keystrokes through.
 */
export function canvasAria(label = 'Three-body visualiser'): Record<string, string> {
  return buildAria('application', label, {
    extra: { 'aria-roledescription': 'interactive plot', tabindex: 0 },
  });
}

/** The polite live-status region (see live_region.ts). */
export function statusAria(): Record<string, string> {
  return buildAria('status', 'Status', {
    extra: { 'aria-live': 'polite', 'aria-atomic': true },
  });
}
