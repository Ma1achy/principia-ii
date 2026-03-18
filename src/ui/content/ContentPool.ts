/**
 * @fileoverview Content Pool System
 * Provides weighted random selection with session-sticky caching and no-repeat protection
 * Used for randomized button labels and tooltip content (future)
 */

/**
 * Pool entry
 */
export interface PoolEntry {
  /** Display text (also serves as unique identifier) */
  text: string;
  /** Selection weight (higher = more likely) */
  weight?: number;
  /** Entry classification (e.g. 'formal', 'poetic', 'humorous') */
  kind?: string;
  /** Conditional matching (future use) */
  when?: Record<string, any>;
}

/**
 * Pool pair entry
 */
export interface PoolPair {
  cancel: string;
  confirm: string;
  weight?: number;
}

/**
 * Pool definition
 */
export interface Pool {
  /** Pool identifier */
  id: string;
  /** Human-readable description */
  description: string;
  /** Array of selectable entries */
  entries: PoolEntry[];
  /** Array of paired entries (e.g., cancel/confirm pairs) */
  pairs?: PoolPair[];
  /** Default pair fallback */
  defaultPair?: { cancel: string; confirm: string };
}

/**
 * Content pool options
 */
export interface ContentPoolOptions {
  /** Random number generator (0-1), defaults to Math.random */
  rng?: () => number;
  /** Number of recent entries to avoid */
  noRepeatLast?: number;
}

/**
 * Selection options
 */
export interface SelectOptions {
  /** Use session-sticky caching */
  session?: boolean;
  /** Enable no-repeat protection */
  noRepeat?: boolean;
  /** Context filter (future use) */
  filter?: Record<string, any>;
  /** Fallback text if selection fails */
  fallback?: string;
}

/**
 * Pair selection options
 */
export interface SelectPairOptions {
  /** Fallback pair */
  fallback?: { cancel: string; confirm: string };
}

/**
 * Pool statistics
 */
export interface PoolStats {
  poolId: string;
  description: string;
  totalEntries: number;
  recentCount: number;
  recentTexts: string[];
  cachedSelection: string | undefined;
  hasCached: boolean;
}

/**
 * Content pool selector with weighted randomization
 */
export class ContentPool {
  private pools: Record<string, Pool>;
  private rng: () => number;
  private noRepeatLast: number;
  private sessionCache: Map<string, string>;
  private history: Map<string, string[]>;

  constructor(pools: Record<string, Pool>, options: ContentPoolOptions = {}) {
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
   */
  select(poolId: string, options: SelectOptions = {}): string {
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
        return this.sessionCache.get(poolId)!;
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
   */
  selectPair(poolId: string, options: SelectPairOptions = {}): { cancel: string; confirm: string } {
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
   */
  private _getFallback(customFallback: string | undefined, poolId: string): string {
    if (customFallback) {
      return customFallback;
    }
    
    console.warn(`[ContentPool] No fallback provided for pool: ${poolId}`);
    return 'OK';
  }
  
  /**
   * Weighted random selection
   */
  private _weightedSelect<T extends { weight?: number }>(entries: T[]): T {
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
   */
  private _applyContextFilter(entries: PoolEntry[], context: Record<string, any>): PoolEntry[] {
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
   */
  resetSession(poolId?: string): void {
    if (poolId) {
      this.sessionCache.delete(poolId);
    } else {
      this.sessionCache.clear();
    }
  }
  
  /**
   * Clear history for a specific pool or all pools
   */
  clearHistory(poolId?: string): void {
    if (poolId) {
      this.history.delete(poolId);
    } else {
      this.history.clear();
    }
  }
  
  /**
   * Invalidate cache and history (full reset)
   */
  invalidate(poolId?: string): void {
    this.resetSession(poolId);
    this.clearHistory(poolId);
  }
  
  /**
   * Peek at current session selection without selecting
   */
  peek(poolId: string): string | null {
    return this.sessionCache.get(poolId) || null;
  }
  
  /**
   * Get pool statistics (for debugging)
   */
  getStats(poolId: string): PoolStats {
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
