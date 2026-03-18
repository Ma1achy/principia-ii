/**
 * FocusVisualizer - Renders the single visible navigation cursor
 * Orange for focus, cyan for interaction, animated brackets for enterable nodes
 */

interface FocusVisualizerState {
  element: HTMLElement | null;
  isEnterable: boolean;
  isInteracting: boolean;
}

interface RenderState {
  element: HTMLElement;
  isEnterable?: boolean;
  isInteracting?: boolean;
}

interface Brackets {
  topLeft: HTMLElement | null;
  topRight: HTMLElement | null;
  bottomLeft: HTMLElement | null;
  bottomRight: HTMLElement | null;
}

interface CursorEdges {
  top: HTMLElement;
  right: HTMLElement;
  bottom: HTMLElement;
  left: HTMLElement;
}

export class FocusVisualizer {
  container: HTMLElement;
  cursor: HTMLElement;
  brackets: Brackets;
  cursorEdges: CursorEdges;
  animationFrameId: number | null;
  currentState: FocusVisualizerState;
  resizeObserver: ResizeObserver | null;

  constructor(container: HTMLElement = document.body) {
    this.container = container;
    this.cursor = document.createElement('div');
    this.brackets = { topLeft: null, topRight: null, bottomLeft: null, bottomRight: null };
    this.cursorEdges = { top: document.createElement('div'), right: document.createElement('div'), bottom: document.createElement('div'), left: document.createElement('div') };
    this.animationFrameId = null;
    this.currentState = {
      element: null,
      isEnterable: false,
      isInteracting: false
    };
    
    this._createCursorElement();
    this._createBrackets();
    
    // Add event listeners for scroll/resize
    this._setupEventListeners();
    
    // ResizeObserver for element size changes
    this.resizeObserver = new ResizeObserver(() => {
      if (this.currentState.element) {
        this._updateCursorPosition(this.currentState.element);
      }
    });
  }
  
  /**
   * Setup event listeners for scroll and resize
   */
  private _setupEventListeners(): void {
    // Window resize
    window.addEventListener('resize', () => {
      if (this.currentState.element) {
        this._updateCursorPosition(this.currentState.element);
      }
    });
    
    // Scroll events (capture phase to catch all scrollable containers)
    window.addEventListener('scroll', () => {
      if (this.currentState.element) {
        this._updateCursorPosition(this.currentState.element);
      }
    }, true);
  }

  /**
   * Create cursor overlay element with 4 edges for inner/outer glow
   */
  private _createCursorElement(): void {
    this.cursor = document.createElement('div');
    this.cursor.className = 'nav-cursor';
    this.cursor.setAttribute('aria-hidden', 'true');
    this.cursor.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 999999;
      transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
      display: none;
    `;
    
    // Create 4 edge pieces for glow effect
    this.cursorEdges = {
      top: this._createEdge('top'),
      right: this._createEdge('right'),
      bottom: this._createEdge('bottom'),
      left: this._createEdge('left')
    };
    
    // Append edges to cursor
    Object.values(this.cursorEdges).forEach(edge => {
      this.cursor.appendChild(edge);
    });
    
    this.container.appendChild(this.cursor);
  }
  
  /**
   * Create a single cursor edge
   */
  private _createEdge(position: string): HTMLElement {
    const edge = document.createElement('div');
    edge.className = `nav-cursor-edge nav-cursor-edge--${position}`;
    return edge;
  }

  /**
   * Create corner bracket elements
   */
  private _createBrackets(): void {
    const positions: Array<keyof Brackets> = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
    
    positions.forEach(pos => {
      const bracket = document.createElement('div');
      bracket.className = `nav-bracket nav-bracket--${pos}`;
      bracket.setAttribute('aria-hidden', 'true');
      bracket.style.cssText = `
        position: fixed;
        width: 12px;
        height: 12px;
        pointer-events: none;
        z-index: 999998;
        display: none;
        opacity: 0;
      `;
      
      // Set border based on position
      const borderStyles: Record<string, string> = {
        topLeft: 'border-left: 2px solid; border-top: 2px solid;',
        topRight: 'border-right: 2px solid; border-top: 2px solid;',
        bottomLeft: 'border-left: 2px solid; border-bottom: 2px solid;',
        bottomRight: 'border-right: 2px solid; border-bottom: 2px solid;'
      };
      bracket.style.cssText += borderStyles[pos];
      
      this.brackets[pos] = bracket;
      this.container.appendChild(bracket);
    });
  }

  /**
   * Render cursor at element position
   */
  render(state: RenderState): void {
    const { element, isEnterable = false, isInteracting = false } = state;
    
    console.log('[FocusVisualizer] render called:', { 
      hasElement: !!element, 
      elementTag: element?.tagName,
      elementId: element?.id,
      elementClass: element?.className,
      isEnterable, 
      isInteracting 
    });
    
    if (!element) {
      console.log('[FocusVisualizer] No element, hiding');
      this.hide();
      return;
    }

    this.currentState = { element, isEnterable, isInteracting };
    
    // Observe element for size changes
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver.observe(element);
    }
    
    // Scroll element into view if needed
    this._scrollIntoView(element);

    // Update cursor position and style
    this._updateCursorPosition(element);
    this._updateCursorStyle(isInteracting);
    
    // Show cursor
    this.cursor.style.display = 'block';
    console.log('[FocusVisualizer] Cursor shown at:', this.cursor.style.left, this.cursor.style.top);
  }

  /**
   * Update cursor position to match element
   */
  private _updateCursorPosition(element: HTMLElement): void {
    if (!element) return;

    const rect = element.getBoundingClientRect();
    
    // Position cursor to float around element with 4px gap
    const gap = 4;
    this.cursor.style.left = `${rect.left - gap}px`;
    this.cursor.style.top = `${rect.top - gap}px`;
    this.cursor.style.width = `${rect.width + gap * 2}px`;
    this.cursor.style.height = `${rect.height + gap * 2}px`;
  }
  
  /**
   * Scroll element into view if off-screen or partially visible
   */
  private _scrollIntoView(element: HTMLElement): void {
    const rect = element.getBoundingClientRect();
    const viewport = {
      top: 0,
      bottom: window.innerHeight,
      left: 0,
      right: window.innerWidth
    };
    
    // Check if element is off-screen or partially visible
    const isOffScreen = 
      rect.bottom < viewport.top ||
      rect.top > viewport.bottom ||
      rect.right < viewport.left ||
      rect.left > viewport.right;
    
    const isPartiallyVisible = 
      rect.top < viewport.top ||
      rect.bottom > viewport.bottom ||
      rect.left < viewport.left ||
      rect.right > viewport.right;
    
    if (!isOffScreen && !isPartiallyVisible) {
      return; // Element is fully visible
    }
    
    // Check if element is in sidebar
    const sidebar = element.closest('.sidebar-content');
    if (sidebar) {
      this._scrollSidebarToElement(element, sidebar as HTMLElement);
    } else {
      // Scroll window to center element
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      const scrollX = centerX - viewport.right / 2;
      const scrollY = centerY - viewport.bottom / 2;
      
      window.scrollTo({
        left: window.scrollX + scrollX,
        top: window.scrollY + scrollY,
        behavior: 'smooth'
      });
    }
  }
  
  /**
   * Scroll sidebar to show element centered
   */
  private _scrollSidebarToElement(element: HTMLElement, sidebar: HTMLElement): void {
    const sidebarRect = sidebar.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    
    // Calculate position relative to sidebar
    const relativeTop = elementRect.top - sidebarRect.top;
    const relativeBottom = elementRect.bottom - sidebarRect.top;
    
    // Check if element is outside visible area of sidebar
    const isAbove = relativeTop < 0;
    const isBelow = relativeBottom > sidebar.clientHeight;
    
    if (isAbove || isBelow) {
      // Scroll to center element in sidebar
      const scrollCenter = sidebar.scrollTop + relativeTop - sidebar.clientHeight / 2 + elementRect.height / 2;
      
      sidebar.scrollTo({
        top: scrollCenter,
        behavior: 'smooth'
      });
    }
  }

  /**
   * Update cursor color based on interaction state
   */
  private _updateCursorStyle(isInteracting: boolean): void {
    if (isInteracting) {
      this.cursor.style.borderColor = '#00d4ff';
      this.cursor.style.boxShadow = '0 0 8px 2px rgba(0, 212, 255, 0.6)';
      this.cursor.classList.add('nav-cursor--interacting');
    } else {
      this.cursor.style.borderColor = '#ff6b35';
      this.cursor.style.boxShadow = '0 0 8px 2px rgba(255, 107, 53, 0.6)';
      this.cursor.classList.remove('nav-cursor--interacting');
    }
  }

  /**
   * Show animated corner brackets
   */
  private _showBrackets(element: HTMLElement): void {
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const offset = 6;

    const positions = {
      topLeft: { left: rect.left - offset, top: rect.top - offset },
      topRight: { left: rect.right - offset - 12, top: rect.top - offset },
      bottomLeft: { left: rect.left - offset, top: rect.bottom - offset - 12 },
      bottomRight: { left: rect.right - offset - 12, top: rect.bottom - offset - 12 }
    };

    Object.entries(positions).forEach(([key, pos]) => {
      const bracket = this.brackets[key as keyof Brackets];
      if (bracket) {
        bracket.style.left = `${pos.left}px`;
        bracket.style.top = `${pos.top}px`;
        bracket.style.borderColor = '#ff6b35';
        bracket.style.display = 'block';
        
        requestAnimationFrame(() => {
          bracket.style.opacity = '1';
          bracket.style.transition = 'opacity 0.2s ease-out, transform 0.4s ease-out';
        });
      }
    });

    this._startBracketAnimation();
  }

  /**
   * Hide corner brackets
   */
  private _hideBrackets(): void {
    Object.values(this.brackets).forEach(bracket => {
      if (bracket) {
        bracket.style.opacity = '0';
        setTimeout(() => {
          bracket.style.display = 'none';
        }, 200);
      }
    });

    this._stopBracketAnimation();
  }

  /**
   * Start bracket pulsing animation
   */
  private _startBracketAnimation(): void {
    if (this.animationFrameId) return;

    const startTime = performance.now();
    
    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const cycle = Math.sin(elapsed / 600) * 0.15 + 0.85;

      Object.values(this.brackets).forEach(bracket => {
        if (bracket && bracket.style.display !== 'none') {
          bracket.style.opacity = String(cycle);
        }
      });

      this.animationFrameId = requestAnimationFrame(animate);
    };

    this.animationFrameId = requestAnimationFrame(animate);
  }

  /**
   * Stop bracket animation
   */
  private _stopBracketAnimation(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Hide cursor and brackets
   */
  hide(): void {
    this.cursor.style.display = 'none';
    this._hideBrackets();
    this.currentState = { element: null, isEnterable: false, isInteracting: false };
    
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
  }

  /**
   * Update cursor position (for dynamic layout changes)
   */
  update(): void {
    if (this.currentState.element) {
      this.render(this.currentState as RenderState);
    }
  }

  /**
   * Cleanup and remove from DOM
   */
  destroy(): void {
    this._stopBracketAnimation();
    this.cursor?.remove();
    Object.values(this.brackets).forEach(b => b?.remove());
    
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }
}
