/**
 * Simple event emitter for tree mutations
 * Supports on(), off(), emit() for reactive updates
 */

export type EventHandler<T = any> = (payload: T) => void;

export class EventEmitter<TEvents extends Record<string, any> = Record<string, any>> {
  private _handlers: Map<keyof TEvents, EventHandler[]>;

  constructor() {
    this._handlers = new Map();
  }

  /**
   * Subscribe to an event
   * @param event - Event name
   * @param handler - Handler function
   */
  on<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): void {
    if (!this._handlers.has(event)) {
      this._handlers.set(event, []);
    }
    this._handlers.get(event)!.push(handler);
  }

  /**
   * Unsubscribe from an event
   * @param event - Event name
   * @param handler - Handler function to remove
   */
  off<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): void {
    if (!this._handlers.has(event)) return;
    const handlers = this._handlers.get(event)!;
    const index = handlers.indexOf(handler);
    if (index !== -1) {
      handlers.splice(index, 1);
    }
  }

  /**
   * Emit an event to all subscribers
   * @param event - Event name
   * @param payload - Event payload
   */
  emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
    if (!this._handlers.has(event)) return;
    const handlers = this._handlers.get(event)!;
    handlers.forEach(handler => {
      try {
        handler(payload);
      } catch (error) {
        console.error(`Error in event handler for "${String(event)}":`, error);
      }
    });
  }

  /**
   * Get count of handlers for an event
   * @param event - Event name
   * @returns Number of handlers
   */
  listenerCount<K extends keyof TEvents>(event: K): number {
    return this._handlers.has(event) ? this._handlers.get(event)!.length : 0;
  }

  /**
   * Remove all handlers for all events
   */
  removeAllListeners(): void {
    this._handlers.clear();
  }
}
