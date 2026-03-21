/**
 * Global Z-Index Layer System
 * 
 * Provides a centralized, stack-based z-index management system.
 * All UI components should use this instead of hardcoded z-index values.
 * 
 * Architecture:
 * - Base layer spacing: 1000 units per stack level
 * - Each overlay/dialog adds a new stack level
 * - Tooltips always at maximum (100000)
 * - Cursor sits at current stack level × 1000
 * 
 * Usage:
 *   import { ZIndex } from './ui/core/z-index.js';
 *   element.style.zIndex = String(ZIndex.forOverlay(stackDepth));
 */

// ─── Constants ──────────────────────────────────────────────────────────────

/** Spacing between stack levels (1000 units per level) */
export const LAYER_SPACING = 1000;

/** Base z-index for root content */
export const BASE_LAYER = 0;

/** Reserved z-index ranges */
export const Z_RANGES = {
  /** Background elements (0-99) */
  BACKGROUND: 0,
  
  /** Main content layer (100-999) */
  CONTENT: 100,
  
  /** Sidebar and fixed UI (1000-1999) */
  SIDEBAR: 1000,
  
  /** First overlay level (2000-2999) */
  OVERLAY_1: 2000,
  
  /** Second overlay level (3000-3999) */
  OVERLAY_2: 3000,
  
  /** Third overlay level (4000-4999) */
  OVERLAY_3: 4000,
  
  /** Tooltips, always on top (100000+) */
  TOOLTIP: 100000,
} as const;

// ─── Stack Depth Tracking ───────────────────────────────────────────────────

let currentStackDepth = 1;

/**
 * Set the current stack depth (called by navigation manager)
 */
export function setStackDepth(depth: number): void {
  currentStackDepth = Math.max(1, depth);
}

/**
 * Get the current stack depth
 */
export function getStackDepth(): number {
  return currentStackDepth;
}

// ─── Z-Index Calculation Functions ──────────────────────────────────────────

/**
 * Calculate z-index for an overlay/dialog at given stack depth
 * @param depth - Stack depth (1 = root, 2 = first overlay, 3 = nested overlay, etc.)
 * @returns z-index value
 */
export function forOverlay(depth: number = currentStackDepth): number {
  return depth * LAYER_SPACING;
}

/**
 * Calculate z-index for the keyboard navigation cursor at current stack depth
 * Cursor sits slightly above the current layer
 * @returns z-index value
 */
export function forCursor(depth: number = currentStackDepth): number {
  return depth * LAYER_SPACING + 500;
}

/**
 * Calculate z-index for overlay content (sits below cursor)
 * @param depth - Stack depth
 * @returns z-index value
 */
export function forOverlayContent(depth: number = currentStackDepth): number {
  return depth * LAYER_SPACING + 100;
}

/**
 * Get z-index for tooltips (always maximum)
 * @returns z-index value
 */
export function forTooltip(): number {
  return Z_RANGES.TOOLTIP;
}

/**
 * Get z-index for sidebar and fixed UI
 * @returns z-index value
 */
export function forSidebar(): number {
  return Z_RANGES.SIDEBAR;
}

/**
 * Get z-index for main content
 * @returns z-index value
 */
export function forContent(): number {
  return Z_RANGES.CONTENT;
}

/**
 * Get z-index for background elements
 * @returns z-index value
 */
export function forBackground(): number {
  return Z_RANGES.BACKGROUND;
}

// ─── CSS Variable Export ────────────────────────────────────────────────────

/**
 * Update CSS custom properties with current z-index values
 * Call this when stack depth changes
 */
export function updateCSSVariables(): void {
  const root = document.documentElement;
  
  root.style.setProperty('--z-background', String(Z_RANGES.BACKGROUND));
  root.style.setProperty('--z-content', String(Z_RANGES.CONTENT));
  root.style.setProperty('--z-sidebar', String(Z_RANGES.SIDEBAR));
  root.style.setProperty('--z-tooltip', String(Z_RANGES.TOOLTIP));
  
  // Dynamic values based on current stack
  root.style.setProperty('--z-overlay-current', String(forOverlay()));
  root.style.setProperty('--z-cursor-current', String(forCursor()));
}

// ─── Convenience Export ─────────────────────────────────────────────────────

export const ZIndex = {
  forOverlay,
  forCursor,
  forOverlayContent,
  forTooltip,
  forSidebar,
  forContent,
  forBackground,
  updateCSSVariables,
  setStackDepth,
  getStackDepth,
  RANGES: Z_RANGES,
  LAYER_SPACING,
} as const;

// Initialize CSS variables on load
if (typeof document !== 'undefined') {
  updateCSSVariables();
}
