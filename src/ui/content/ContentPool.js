/**
 * @fileoverview Content Pool System
 * Provides weighted random selection with session-sticky caching and no-repeat protection
 * Used for randomized button labels and tooltip content (future)
 */

/**
 * @typedef {Object} PoolEntry
 * @property {string} text - Display text (also serves as unique identifier)
 * @property {number} [weight=1.0] - Selection weight (higher = more likely)
 * @property {string} [kind] - Entry classification (e.g. 'formal', 'poetic', 'humorous')
 * @property {Object} [when] - Conditional matching (future use)
 */

/**
 * @typedef {Object} Pool
 * @property {string} id - Pool identifier
 * @property {string} description - Human-readable description
 * @property {PoolEntry[]} entries - Array of selectable entries
 */

/**
 * @typedef {Object} ContentPoolOptions
 * @property {Function} [rng] - Random number generator (0-1), defaults to Math.random
 * @property {number} [noRepeatLast=5] - Number of recent entries to avoid
 */

/**
 * Content pool selector with weighted randomization
 */
export class ContentPool {
  /**
   * @param {Object<string, Pool>} pools - Pool definitions by ID
   * @param {ContentPoolOptions} [options={}] - Configuration options
   */
  constructor(pools, options = {}) {
    this.pools = pools;
    this.rng = options.rng || (() => Math.random());
    this.noRepeatLast = options.noRepeatLast || 5;
    
    // Session cache: poolId -> selected entry
    this.sessionCache = new Map();
    
    // History tracking for no-repeat: poolId -> [entryId, entryId, ...]
    this.history = new Map();
  }
  
  /**
   * Select an entry from a pool
   * @param {string} poolId - Pool identifier
   * @param {Object} [options={}] - Selection options
   * @param {boolean} [options.session=true] - Use session-sticky caching
   * @param {boolean} [options.noRepeat=true] - Enable no-repeat protection
   * @param {Object} [options.filter] - Context filter (future use)
   * @param {string} [options.fallback] - Fallback text if selection fails
   * @returns {string} Selected text
   */
  select(poolId, options = {}) {
    try {
      const pool = this.pools[poolId];
      if (!pool) {
        console.warn(`[ContentPool] Unknown pool: ${poolId}`);
        return this._getFallback(options.fallback, poolId);
      }
      
      if (!pool.entries || pool.entries.length === 0) {
        console.warn(`[ContentPool] Empty pool: ${poolId}`);
        return this._getFallback(options.fallback, poolId);
      }
      
      const useSession = options.session !== false;
      const useNoRepeat = options.noRepeat !== false;
      
      // Check session cache
      if (useSession && this.sessionCache.has(poolId)) {
        return this.sessionCache.get(poolId);
      }
      
      // Filter candidates
      let candidates = pool.entries;
      
    // Apply no-repeat protection
    if (useNoRepeat) {
      const recentTexts = this.history.get(poolId) || [];
      candidates = candidates.filter(entry => !recentTexts.includes(entry.text));
      
      // Fallback: if all entries excluded, use full pool
      if (candidates.length === 0) {
        candidates = pool.entries;
      }
    }
      
      // Apply context filter (future)
      if (options.filter) {
        candidates = this._applyContextFilter(candidates, options.filter);
      }
      
      // Final safety check
      if (candidates.length === 0) {
        console.warn(`[ContentPool] No candidates after filtering: ${poolId}`);
        return this._getFallback(options.fallback, poolId);
      }
      
      // Weighted selection
      const selected = this._weightedSelect(candidates);
      
      if (!selected || !selected.text) {
        console.warn(`[ContentPool] Invalid selection result: ${poolId}`);
        return this._getFallback(options.fallback, poolId);
      }
      
    // Update history
    if (useNoRepeat) {
      const history = this.history.get(poolId) || [];
      history.push(selected.text);
      if (history.length > this.noRepeatLast) {
        history.shift();
      }
      this.history.set(poolId, history);
    }
      
      // Cache for session
      if (useSession) {
        this.sessionCache.set(poolId, selected.text);
      }
      
      return selected.text;
    } catch (err) {
      console.error(`[ContentPool] Selection failed for ${poolId}:`, err);
      return this._getFallback(options.fallback, poolId);
    }
  }
  
  /**
   * Select a pair of related entries (e.g., cancel/confirm button pair)
   * @param {string} poolId - Pool identifier for paired entries
   * @param {Object} [options={}] - Selection options
   * @param {Object} [options.fallback] - Fallback pair {cancel: string, confirm: string}
   * @returns {{cancel: string, confirm: string}} Selected pair
   */
  selectPair(poolId, options = {}) {
    try {
      const pool = this.pools[poolId];
      if (!pool) {
        console.warn(`[ContentPool] Unknown pair pool: ${poolId}`);
        return options.fallback || { cancel: 'CANCEL', confirm: 'OK' };
      }
      
      if (!pool.pairs || pool.pairs.length === 0) {
        console.warn(`[ContentPool] No pairs in pool: ${poolId}`);
        return options.fallback || pool.defaultPair || { cancel: 'CANCEL', confirm: 'OK' };
      }
      
      // Weighted selection from pairs
      const selectedPair = this._weightedSelect(pool.pairs);
      
      if (!selectedPair || !selectedPair.cancel || !selectedPair.confirm) {
        console.warn(`[ContentPool] Invalid pair selected from: ${poolId}`);
        return options.fallback || pool.defaultPair || { cancel: 'CANCEL', confirm: 'OK' };
      }
      
      return {
        cancel: selectedPair.cancel,
        confirm: selectedPair.confirm
      };
    } catch (err) {
      console.error(`[ContentPool] Pair selection failed for ${poolId}:`, err);
      return options.fallback || { cancel: 'CANCEL', confirm: 'OK' };
    }
  }
  
  /**
   * Get fallback text when selection fails
   * @private
   * @param {string} [customFallback] - Custom fallback text (from button.label)
   * @param {string} poolId - Pool identifier
   * @returns {string} Fallback text
   */
  _getFallback(customFallback, poolId) {
    // DEFENSIVE PROGRAMMING: Button's label is the primary fallback
    if (customFallback) {
      return customFallback;
    }
    
    // Ultimate generic fallback (should never be reached if button has label)
    console.warn(`[ContentPool] No fallback provided for pool: ${poolId}`);
    return 'OK';
  }
  
  /**
   * Weighted random selection
   * @private
   * @param {PoolEntry[]} entries - Candidate entries
   * @returns {PoolEntry} Selected entry
   */
  _weightedSelect(entries) {
    // Calculate total weight
    const totalWeight = entries.reduce((sum, entry) => sum + (entry.weight || 1.0), 0);
    
    // Random selection
    let random = this.rng() * totalWeight;
    
    for (const entry of entries) {
      random -= (entry.weight || 1.0);
      if (random <= 0) {
        return entry;
      }
    }
    
    // Fallback (should never happen unless rng returns exactly 1.0)
    return entries[entries.length - 1];
  }
  
  /**
   * Apply context-based filtering (future use)
   * @private
   * @param {PoolEntry[]} entries - Entries to filter
   * @param {Object} context - Filter context
   * @returns {PoolEntry[]} Filtered entries
   */
  _applyContextFilter(entries, context) {
    // Future: filter by context.emotion, context.mobile, etc.
    return entries.filter(entry => {
      if (!entry.when) return true;
      
      // Example filter logic (not yet implemented)
      // if (entry.when.emotion && !entry.when.emotion.includes(context.emotion)) {
      //   return false;
      // }
      
      return true;
    });
  }
  
  /**
   * Reset session cache for a specific pool or all pools
   * @param {string} [poolId] - Pool to reset, or undefined for all
   */
  resetSession(poolId) {
    if (poolId) {
      this.sessionCache.delete(poolId);
    } else {
      this.sessionCache.clear();
    }
  }
  
  /**
   * Clear history for a specific pool or all pools
   * @param {string} [poolId] - Pool to clear, or undefined for all
   */
  clearHistory(poolId) {
    if (poolId) {
      this.history.delete(poolId);
    } else {
      this.history.clear();
    }
  }
  
  /**
   * Invalidate cache and history (full reset)
   * @param {string} [poolId] - Pool to invalidate, or undefined for all
   */
  invalidate(poolId) {
    this.resetSession(poolId);
    this.clearHistory(poolId);
  }
  
  /**
   * Peek at current session selection without selecting
   * @param {string} poolId - Pool identifier
   * @returns {string|null} Cached selection or null
   */
  peek(poolId) {
    return this.sessionCache.get(poolId) || null;
  }
  
  /**
   * Get pool statistics (for debugging)
   * @param {string} poolId - Pool identifier
   * @returns {Object} Pool statistics
   */
  getStats(poolId) {
    const pool = this.pools[poolId];
    if (!pool) {
      throw new Error(`Unknown pool: ${poolId}`);
    }
    
    const recentTexts = this.history.get(poolId) || [];
    const cached = this.sessionCache.get(poolId);
    
    return {
      poolId: pool.id,
      description: pool.description,
      totalEntries: pool.entries.length,
      recentCount: recentTexts.length,
      recentTexts: [...recentTexts],
      cachedSelection: cached,
      hasCached: cached !== undefined
    };
  }
}
