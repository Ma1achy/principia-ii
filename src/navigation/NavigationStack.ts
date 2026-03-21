/**
 * NavigationStack - Unified navigation state stack
 * Single source of truth for navigation position, overlay state, and interaction mode
 */

export type FrameType = 'grid' | 'overlay' | 'interaction';
export type OverlayKind = 'dialog' | 'panel' | 'dropdown' | 'picker';

/**
 * Navigation frame - represents one level in the navigation hierarchy
 */
export interface NavigationFrame {
  type: FrameType;
  
  // Position (all frames have these)
  gridId: string;
  cellId: string;
  coords: [number, number];
  
  // Overlay-specific data
  overlayId?: string;
  triggerId?: string | null;
  overlayKind?: OverlayKind;
  
  // Interaction-specific data
  interactingNodeId?: string;
  
  // Control flags
  readonly: boolean;  // Can't escape from modals
  
  // Additional metadata
  meta?: Record<string, any>;
}

/**
 * NavigationStack - manages the stack of navigation frames
 */
export class NavigationStack {
  private frames: NavigationFrame[] = [];
  private onChange?: (frame: NavigationFrame | null) => void;
  
  constructor(onChange?: (frame: NavigationFrame | null) => void) {
    this.onChange = onChange;
  }
  
  /**
   * Push a new frame onto the stack
   */
  push(frame: NavigationFrame): void {
    this.frames.push(frame);
    console.log('[NavStack] Push:', this._frameToString(frame), '- depth:', this.frames.length);
    this.onChange?.(this.peek());
  }
  
  /**
   * Pop the top frame from the stack
   */
  pop(): NavigationFrame | null {
    if (this.frames.length === 0) {
      console.warn('[NavStack] Cannot pop - stack is empty');
      return null;
    }
    
    const frame = this.frames.pop() || null;
    console.log('[NavStack] Pop:', frame ? this._frameToString(frame) : 'null', '- depth:', this.frames.length);
    this.onChange?.(this.peek());
    return frame;
  }
  
  /**
   * Get the top frame without removing it
   */
  peek(): NavigationFrame | null {
    return this.frames.length > 0 ? this.frames[this.frames.length - 1] : null;
  }
  
  /**
   * Get a frame at a specific index (0 = bottom, length-1 = top)
   */
  peekAt(index: number): NavigationFrame | null {
    if (index < 0 || index >= this.frames.length) {
      return null;
    }
    return this.frames[index];
  }
  
  /**
   * Find the first frame matching the predicate, searching from top to bottom
   */
  findFrame(predicate: (frame: NavigationFrame) => boolean): NavigationFrame | null {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (predicate(this.frames[i])) {
        return this.frames[i];
      }
    }
    return null;
  }
  
  /**
   * Find the index of the first frame matching the predicate
   */
  findFrameIndex(predicate: (frame: NavigationFrame) => boolean): number {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (predicate(this.frames[i])) {
        return i;
      }
    }
    return -1;
  }
  
  /**
   * Pop frames until the predicate matches (pops the matching frame too)
   * Returns the matched frame, or null if not found
   */
  popUntil(predicate: (frame: NavigationFrame) => boolean): NavigationFrame | null {
    const poppedFrames: NavigationFrame[] = [];
    
    while (this.frames.length > 0) {
      const frame = this.pop();
      if (!frame) break;
      
      poppedFrames.push(frame);
      
      if (predicate(frame)) {
        console.log('[NavStack] popUntil matched, popped', poppedFrames.length, 'frames');
        return frame;
      }
    }
    
    console.warn('[NavStack] popUntil predicate never matched, popped', poppedFrames.length, 'frames');
    return null;
  }
  
  /**
   * Get the current stack depth
   */
  depth(): number {
    return this.frames.length;
  }
  
  /**
   * Clear the stack to a specific depth (removes all frames above that depth)
   */
  clearTo(depth: number): void {
    if (depth < 0) {
      depth = 0;
    }
    
    const removed = this.frames.length - depth;
    if (removed > 0) {
      console.log('[NavStack] clearTo:', depth, '- removing', removed, 'frames');
      this.frames.length = depth;
      this.onChange?.(this.peek());
    }
  }
  
  /**
   * Find the depth of the last overlay in the stack (-1 if no overlay)
   */
  findLastOverlayDepth(): number {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i].type === 'overlay') {
        return i + 1; // Return depth after the overlay
      }
    }
    return 0; // No overlay found, return root depth
  }
  
  /**
   * Check if currently inside an overlay
   */
  isInsideOverlay(): boolean {
    return this.frames.some(f => f.type === 'overlay');
  }
  
  /**
   * Get the current overlay frame (topmost overlay in stack)
   */
  getCurrentOverlay(): NavigationFrame | null {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i].type === 'overlay') {
        return this.frames[i];
      }
    }
    return null;
  }
  
  /**
   * Clear all frames from the stack
   */
  clear(): void {
    console.log('[NavStack] Clearing all', this.frames.length, 'frames');
    this.frames = [];
    this.onChange?.(null);
  }
  
  /**
   * Get a debug string representation of the stack
   */
  toDebugString(): string {
    if (this.frames.length === 0) {
      return '[NavStack] Empty';
    }
    
    const lines = [`[NavStack] Depth: ${this.frames.length}`];
    this.frames.forEach((frame, index) => {
      lines.push(`  [${index}] ${this._frameToString(frame)}`);
    });
    return lines.join('\n');
  }
  
  /**
   * Convert a frame to a readable string
   */
  private _frameToString(frame: NavigationFrame): string {
    const parts: string[] = [frame.type];
    
    if (frame.overlayId) {
      parts.push(`overlay=${frame.overlayId}`);
    }
    
    parts.push(`grid=${frame.gridId}`);
    parts.push(`cell=${frame.cellId}`);
    parts.push(`coords=[${frame.coords[0]},${frame.coords[1]}]`);
    
    if (frame.interactingNodeId) {
      parts.push(`interacting=${frame.interactingNodeId}`);
    }
    
    if (frame.readonly) {
      parts.push('readonly');
    }
    
    return parts.join(' ');
  }
  
  /**
   * Get a copy of all frames (for debugging/inspection)
   */
  getAllFrames(): ReadonlyArray<NavigationFrame> {
    return [...this.frames];
  }
}
