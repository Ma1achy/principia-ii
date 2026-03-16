/**
 * Simple event emitter for tree mutations
 * Supports on(), off(), emit() for reactive updates
 */
export class EventEmitter {
  constructor() {
    this._handlers = new Map();
  }

  /**
   * Subscribe to an event
   * @param {string} event - Event name
   * @param {Function} handler - Handler function
   */
  on(event, handler) {
    if (!this._handlers.has(event)) {
      this._handlers.set(event, []);
    }
    this._handlers.get(event).push(handler);
  }

  /**
   * Unsubscribe from an event
   * @param {string} event - Event name
   * @param {Function} handler - Handler function to remove
   */
  off(event, handler) {
    if (!this._handlers.has(event)) return;
    const handlers = this._handlers.get(event);
    const index = handlers.indexOf(handler);
    if (index !== -1) {
      handlers.splice(index, 1);
    }
  }

  /**
   * Emit an event to all subscribers
   * @param {string} event - Event name
   * @param {*} payload - Event payload
   */
  emit(event, payload) {
    if (!this._handlers.has(event)) return;
    const handlers = this._handlers.get(event);
    handlers.forEach(handler => {
      try {
        handler(payload);
      } catch (error) {
        console.error(`Error in event handler for "${event}":`, error);
      }
    });
  }

  /**
   * Get count of handlers for an event
   * @param {string} event - Event name
   * @returns {number} Number of handlers
   */
  listenerCount(event) {
    return this._handlers.has(event) ? this._handlers.get(event).length : 0;
  }

  /**
   * Remove all handlers for all events
   */
  removeAllListeners() {
    this._handlers.clear();
  }
}
