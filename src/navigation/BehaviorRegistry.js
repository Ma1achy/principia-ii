/**
 * BehaviorRegistry - Maps node kinds to behavior factories
 * Thin wrapper around Map for type safety
 */

export class BehaviorRegistry {
  constructor() {
    this._registry = new Map();
  }

  /**
   * Register a behavior factory for a node kind
   * @param {string} kind - Node kind (e.g., 'button', 'slider', 'checkbox')
   * @param {Function} factory - Factory function (node, element, deps) => behavior
   */
  register(kind, factory) {
    if (typeof factory !== 'function') {
      throw new Error(`BehaviorRegistry: factory for "${kind}" must be a function`);
    }
    this._registry.set(kind, factory);
  }

  /**
   * Create a behavior instance for a node
   * @param {string} kind - Node kind
   * @param {Object} node - Navigation node
   * @param {HTMLElement} element - DOM element
   * @param {Object} deps - Dependencies to inject
   * @returns {Object|null} Behavior instance or null if not registered
   */
  create(kind, node, element, deps = {}) {
    const factory = this._registry.get(kind);
    if (!factory) {
      return null;
    }
    return factory(node, element, deps);
  }

  /**
   * Check if a behavior is registered for a kind
   * @param {string} kind - Node kind
   * @returns {boolean} True if registered
   */
  has(kind) {
    return this._registry.has(kind);
  }

  /**
   * Get all registered kinds
   * @returns {string[]} Array of registered kinds
   */
  getRegisteredKinds() {
    return Array.from(this._registry.keys());
  }

  /**
   * Unregister a behavior
   * @param {string} kind - Node kind
   */
  unregister(kind) {
    this._registry.delete(kind);
  }

  /**
   * Clear all registered behaviors
   */
  clear() {
    this._registry.clear();
  }
}
