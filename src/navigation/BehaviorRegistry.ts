/**
 * BehaviorRegistry - Maps node kinds to behavior factories
 * Thin wrapper around Map for type safety
 */

import type { UINode } from '../ui/semantic-tree/store.ts';

/**
 * Behavior factory function type
 * Takes a node, element, and dependencies, returns a behavior object
 */
export type BehaviorFactory<TDeps = any, TBehavior = any> = (
  node: UINode,
  element: HTMLElement,
  deps: TDeps
) => TBehavior;

/**
 * Registry for mapping node kinds to behavior factories
 */
export class BehaviorRegistry {
  private _registry: Map<string, BehaviorFactory>;

  constructor() {
    this._registry = new Map();
  }

  /**
   * Register a behavior factory for a node kind
   */
  register(kind: string, factory: BehaviorFactory): void {
    if (typeof factory !== 'function') {
      throw new Error(`BehaviorRegistry: factory for "${kind}" must be a function`);
    }
    this._registry.set(kind, factory);
  }

  /**
   * Create a behavior instance for a node
   * @returns Behavior instance or null if not registered
   */
  create<TDeps = any, TBehavior = any>(
    kind: string,
    node: UINode,
    element: HTMLElement,
    deps: TDeps = {} as TDeps
  ): TBehavior | null {
    const factory = this._registry.get(kind);
    if (!factory) {
      return null;
    }
    return factory(node, element, deps) as TBehavior;
  }

  /**
   * Check if a behavior is registered for a kind
   */
  has(kind: string): boolean {
    return this._registry.has(kind);
  }

  /**
   * Get all registered kinds
   */
  getRegisteredKinds(): string[] {
    return Array.from(this._registry.keys());
  }

  /**
   * Unregister a behavior
   */
  unregister(kind: string): void {
    this._registry.delete(kind);
  }

  /**
   * Clear all registered behaviors
   */
  clear(): void {
    this._registry.clear();
  }
}
