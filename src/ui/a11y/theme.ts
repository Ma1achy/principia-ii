export interface ThemeState {
  highContrast: boolean;
  /** Font-size multiplier on the root (1.0 = default). */
  fontScale: number;
  /** Explicit reduced-motion override; undefined ⇒ defer to the media query. */
  reducedMotion?: boolean;
}

export const DEFAULT_THEME: ThemeState = {
  highContrast: false,
  fontScale: 1.0,
};

/** Clamp the font scale to a sane, accessible range and quantise to 5%. */
export function clampFontScale(scale: number): number {
  const clamped = Math.max(0.75, Math.min(2.0, scale));
  return Math.round(clamped * 20) / 20;
}

/** Step the font scale up/down by 10% within the clamp. Pure. */
export function stepFontScale(scale: number, dir: 1 | -1): number {
  return clampFontScale(scale + dir * 0.1);
}

/**
 * Pure: theme + media-query state → the class list and CSS-variable map for
 * the root element. The shell merges these; tests assert on them directly.
 */
export function themeVars(
  t: ThemeState, prefersReducedMotion: boolean,
): { classes: string[]; vars: Record<string, string> } {
  const classes: string[] = [];
  if (t.highContrast) classes.push('a11y-high-contrast');
  const reduced = t.reducedMotion ?? prefersReducedMotion;
  if (reduced) classes.push('a11y-reduced-motion');
  return {
    classes,
    vars: { '--a11y-font-scale': clampFontScale(t.fontScale).toString() },
  };
}

/** DOM sink: reconcile root classes + the --a11y-font-scale variable. */
export function applyTheme(
  root: HTMLElement, t: ThemeState, prefersReducedMotion: boolean,
): void {
  const { classes, vars } = themeVars(t, prefersReducedMotion);
  root.classList.toggle('a11y-high-contrast', classes.includes('a11y-high-contrast'));
  root.classList.toggle('a11y-reduced-motion', classes.includes('a11y-reduced-motion'));
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

/** Read the OS reduced-motion preference; false where matchMedia is absent
 *  (happy-dom / node) so headless mounts never throw. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
