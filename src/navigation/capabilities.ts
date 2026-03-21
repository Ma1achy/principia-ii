/**
 * Capability system for automatic behavior generation
 * Defines what controls can do and how they should respond to keyboard events
 */

import type { UINode } from '../ui/semantic-tree/store.ts';
import type { BehaviorResultType } from './behaviors.ts';

// ── Type Definitions ───────────────────────────────────────────────────────

export type EscapePolicy = 'auto' | 'modal' | 'custom' | 'bubble';
export type ArrowPolicy = 'navigate' | 'escape-vertical' | 'escape-horizontal' | 'escape-all' | 'custom';
export type Direction = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

/**
 * Behavior capabilities that can be declared in node metadata
 */
export interface BehaviorCapabilities {
  // Core capabilities
  focusable?: boolean;      // Can receive keyboard focus (default: true for leaf nodes)
  activatable?: boolean;    // Responds to Enter/Space (default: true)
  interactive?: boolean;    // Can enter interaction mode (default: false)
  incrementable?: boolean;  // Supports +/- keys (default: false)
  
  // Escape behavior
  escapePolicy?: EscapePolicy;
  
  // Arrow key behavior when NOT interacting
  arrowPolicy?: ArrowPolicy;
  
  // Custom handlers (manual overrides) - now with deps parameter
  onActivate?: (node: UINode, element: HTMLElement | null, deps?: any) => BehaviorResultType;
  onInteract?: (node: UINode, element: HTMLElement | null, isInteracting: boolean, deps?: any) => BehaviorResultType;
  onEscape?: (node: UINode, element: HTMLElement | null, isInteracting: boolean, deps?: any) => BehaviorResultType;
  onArrowKey?: (node: UINode, element: HTMLElement | null, direction: Direction, isInteracting: boolean, deps?: any) => BehaviorResultType;
  onIncrement?: (node: UINode, element: HTMLElement | null, deps?: any) => BehaviorResultType;
  onDecrement?: (node: UINode, element: HTMLElement | null, deps?: any) => BehaviorResultType;
}

/**
 * Resolved capabilities with all defaults applied
 */
export interface ResolvedCapabilities {
  focusable: boolean;
  activatable: boolean;
  interactive: boolean;
  incrementable: boolean;
  escapePolicy: EscapePolicy;
  arrowPolicy: ArrowPolicy;
  
  // Custom handlers preserved as-is (now with deps parameter)
  onActivate?: (node: UINode, element: HTMLElement | null, deps?: any) => BehaviorResultType;
  onInteract?: (node: UINode, element: HTMLElement | null, isInteracting: boolean, deps?: any) => BehaviorResultType;
  onEscape?: (node: UINode, element: HTMLElement | null, isInteracting: boolean, deps?: any) => BehaviorResultType;
  onArrowKey?: (node: UINode, element: HTMLElement | null, direction: Direction, isInteracting: boolean, deps?: any) => BehaviorResultType;
  onIncrement?: (node: UINode, element: HTMLElement | null, deps?: any) => BehaviorResultType;
  onDecrement?: (node: UINode, element: HTMLElement | null, deps?: any) => BehaviorResultType;
}

// ── Default Capability Profiles ────────────────────────────────────────────

/**
 * Default capabilities by node kind
 */
export const DEFAULT_CAPABILITIES: Record<string, Partial<BehaviorCapabilities>> = {
  // Simple activatable controls
  'button': {
    focusable: true,
    activatable: true,
    interactive: false,
    incrementable: false,
    escapePolicy: 'bubble',
    arrowPolicy: 'navigate'
  },
  
  'checkbox': {
    focusable: true,
    activatable: true,
    interactive: false,
    incrementable: false,
    escapePolicy: 'bubble',
    arrowPolicy: 'navigate'
  },
  
  'section-header': {
    focusable: true,
    activatable: true,
    interactive: false,
    incrementable: false,
    escapePolicy: 'bubble',
    arrowPolicy: 'navigate'
  },
  
  'menu-item': {
    focusable: true,
    activatable: true,
    interactive: false,
    incrementable: false,
    escapePolicy: 'bubble',
    arrowPolicy: 'navigate'
  },
  
  // Interactive controls with text input
  'value-editor': {
    focusable: true,
    activatable: true,
    interactive: true,
    incrementable: false,
    escapePolicy: 'auto',
    arrowPolicy: 'escape-vertical'
  },
  
  'analog-control': {
    focusable: true,
    activatable: true,
    interactive: true,
    incrementable: false,
    escapePolicy: 'auto',
    arrowPolicy: 'escape-vertical'
  },
  
  'textarea': {
    focusable: true,
    activatable: true,
    interactive: true,
    incrementable: false,
    escapePolicy: 'auto',
    arrowPolicy: 'navigate'
  },
  
  'code-editor': {
    focusable: true,
    activatable: true,
    interactive: true,
    incrementable: false,
    escapePolicy: 'auto',
    arrowPolicy: 'navigate'
  },
  
  'canvas': {
    focusable: true,
    activatable: true,
    interactive: true,
    incrementable: true,
    escapePolicy: 'auto',
    arrowPolicy: 'navigate'
  },
  
  // Special controls
  'param-trigger': {
    focusable: true,
    activatable: true,
    interactive: false,
    incrementable: false,
    escapePolicy: 'bubble',
    arrowPolicy: 'escape-vertical'
  },
  
  'picker-close-button': {
    focusable: true,
    activatable: true,
    interactive: false,
    incrementable: false,
    escapePolicy: 'bubble',
    arrowPolicy: 'navigate'
  },
  
  'native-select': {
    focusable: true,
    activatable: true,
    interactive: false,
    incrementable: false,
    escapePolicy: 'bubble',
    arrowPolicy: 'navigate'
  },
};

/**
 * Global default capabilities for nodes without a kind-specific profile
 */
const GLOBAL_DEFAULTS: ResolvedCapabilities = {
  focusable: true,
  activatable: false,
  interactive: false,
  incrementable: false,
  escapePolicy: 'bubble',
  arrowPolicy: 'navigate'
};

// ── Capability Resolution ──────────────────────────────────────────────────

/**
 * Resolve capabilities for a node by merging:
 * 1. Global defaults
 * 2. Kind-specific defaults
 * 3. Node-specific metadata
 */
export function resolveCapabilities(node: UINode): ResolvedCapabilities {
  // Start with global defaults
  const resolved: ResolvedCapabilities = { ...GLOBAL_DEFAULTS };
  
  // Apply kind-specific defaults
  if (node.kind && DEFAULT_CAPABILITIES[node.kind]) {
    Object.assign(resolved, DEFAULT_CAPABILITIES[node.kind]);
  }
  
  // Apply node-specific overrides from meta.capabilities
  if (node.meta?.capabilities) {
    const nodeCaps = node.meta.capabilities;
    
    // Merge boolean and enum properties
    if (nodeCaps.focusable !== undefined) resolved.focusable = nodeCaps.focusable;
    if (nodeCaps.activatable !== undefined) resolved.activatable = nodeCaps.activatable;
    if (nodeCaps.interactive !== undefined) resolved.interactive = nodeCaps.interactive;
    if (nodeCaps.incrementable !== undefined) resolved.incrementable = nodeCaps.incrementable;
    if (nodeCaps.escapePolicy !== undefined) resolved.escapePolicy = nodeCaps.escapePolicy;
    if (nodeCaps.arrowPolicy !== undefined) resolved.arrowPolicy = nodeCaps.arrowPolicy;
    
    // Preserve custom handlers
    if (nodeCaps.onActivate) resolved.onActivate = nodeCaps.onActivate;
    if (nodeCaps.onInteract) resolved.onInteract = nodeCaps.onInteract;
    if (nodeCaps.onEscape) resolved.onEscape = nodeCaps.onEscape;
    if (nodeCaps.onArrowKey) resolved.onArrowKey = nodeCaps.onArrowKey;
    if (nodeCaps.onIncrement) resolved.onIncrement = nodeCaps.onIncrement;
    if (nodeCaps.onDecrement) resolved.onDecrement = nodeCaps.onDecrement;
  }
  
  return resolved;
}

/**
 * Check if a node has interactive capabilities
 */
export function isInteractiveNode(node: UINode): boolean {
  const caps = resolveCapabilities(node);
  return caps.interactive;
}

/**
 * Check if a node can be activated
 */
export function isActivatableNode(node: UINode): boolean {
  const caps = resolveCapabilities(node);
  return caps.activatable;
}
