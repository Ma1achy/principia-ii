/**
 * BehaviorComposer - Composes final behaviors from capabilities and overrides
 * Main entry point for capability-based behavior system
 */

import type { UINode } from '../ui/semantic-tree/store.ts';
import type { Behavior } from './behaviors.ts';
import { resolveCapabilities } from './capabilities.ts';
import { createBaseBehavior } from './baseBehavior.ts';

// ── Types ──────────────────────────────────────────────────────────────────

interface BehaviorComposerOptions {
  uiTree?: any;
  behaviorDeps?: Record<string, any>;
}

// ── Behavior Composer ──────────────────────────────────────────────────────

/**
 * Composes behaviors from capabilities and custom overrides
 */
export class BehaviorComposer {
  private uiTree: any;
  private behaviorDeps: Record<string, any>;
  
  constructor(options: BehaviorComposerOptions = {}) {
    this.uiTree = options.uiTree;
    this.behaviorDeps = options.behaviorDeps || {};
  }
  
  /**
   * Compose a complete behavior for a node
   * 
   * Process:
   * 1. Resolve capabilities from node metadata
   * 2. Generate base behavior from capabilities
   * 3. Apply any custom overrides from node.meta.capabilities
   * 4. Return final composed behavior
   */
  composeBehavior(node: UINode, element: HTMLElement | null, deps: any = {}): Behavior {
    // Merge dependencies - make sure uiTree and other deps are available
    const allDeps = { 
      ...this.behaviorDeps, 
      ...deps, 
      uiTree: deps.uiTree || this.uiTree,
      navManager: deps.navManager 
    };
    
    // Check if node has pre-configured capabilities that need deps
    // If so, inject the deps into the capability handlers
    if (node.meta?.capabilities) {
      const caps = node.meta.capabilities;
      
      // Wrap custom handlers to inject deps
      if (caps.onArrowKey) {
        const originalHandler = caps.onArrowKey;
        node = {
          ...node,
          meta: {
            ...node.meta,
            capabilities: {
              ...caps,
              onArrowKey: (n: UINode, el: HTMLElement | null, dir: string, isInt: boolean) => {
                return originalHandler(n, el, dir, isInt, allDeps);
              }
            }
          }
        };
      }
    }
    
    // Resolve capabilities for this node
    const capabilities = resolveCapabilities(node);
    
    // Generate base behavior from capabilities, passing deps
    const baseBehavior = createBaseBehavior(capabilities, node, element, allDeps);
    
    return baseBehavior;
  }
  
  /**
   * Create a behavior factory function for use with BehaviorRegistry
   */
  createFactory(): (node: UINode, element: HTMLElement | null, deps: any) => Behavior {
    return (node: UINode, element: HTMLElement | null, deps: any = {}) => {
      return this.composeBehavior(node, element, deps);
    };
  }
}

/**
 * Helper function to create a composer and get its factory
 */
export function createComposerFactory(options: BehaviorComposerOptions = {}) {
  const composer = new BehaviorComposer(options);
  return composer.createFactory();
}
