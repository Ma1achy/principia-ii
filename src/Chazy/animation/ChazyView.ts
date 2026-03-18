/**
 * ChazyView - Self-contained title + subtitle component
 * 
 * Responsibilities:
 * - Create/mount DOM structure (title + subtitle)
 * - Apply layout constraints from external layout system
 * - Integrate with TextStateMachine for animations
 * - Expose clean API for lifecycle management
 */

import { TextStateMachine } from './textStateMachine.js';

// ─── Types ─────────────────────────────────────────────────────────────────

interface ChazyViewConfig {
  title?: string;
  titleFontRatio?: number;
  subtitleFontRatio?: number;
  gapRatio?: number;
  subtitleWidthRatio?: number;
  opticalCorrection?: number;
}

interface LayoutConstraints {
  maxFontSize?: number;
  availableWidth?: number;
  availableHeight?: number;
}

interface Elements {
  wrapper: HTMLElement | null;
  title: HTMLElement | null;
  subtitle: HTMLElement | null;
}

interface TextConfig {
  displayTime?: number;
  idleTime?: number;
  onComplete: () => void;
  isWelcome?: boolean;
  emotion?: string;
  intensity?: number;
  tone?: string;
}

// ─── ChazyView Class ───────────────────────────────────────────────────────

export class ChazyView {
  config: Required<ChazyViewConfig>;
  mounted: boolean;
  container: HTMLElement | null;
  elements: Elements;
  textStateMachine: TextStateMachine | null;
  constraints: Required<LayoutConstraints>;
  isApplyingLayout: boolean;
  _pendingRefitRafId: number | null;
  
  constructor(options: ChazyViewConfig = {}) {
    this.config = {
      title: options.title || 'Principia',
      titleFontRatio: options.titleFontRatio || 1.0,
      subtitleFontRatio: options.subtitleFontRatio || 0.135,
      gapRatio: options.gapRatio || 0.18,
      subtitleWidthRatio: options.subtitleWidthRatio || 0.97,
      opticalCorrection: options.opticalCorrection || 0.088,
      ...options
    };
    
    this.mounted = false;
    this.container = null;
    this.elements = {
      wrapper: null,
      title: null,
      subtitle: null
    };
    
    this.textStateMachine = null;
    
    this.constraints = {
      maxFontSize: 40,
      availableWidth: 400,
      availableHeight: 100
    };
    
    this.isApplyingLayout = false;
    this._pendingRefitRafId = null;
  }
  
  mount(container: HTMLElement): void {
    if (this.mounted) {
      console.warn('[ChazyView] Already mounted');
      return;
    }
    
    if (!container || !(container instanceof HTMLElement)) {
      console.error('[ChazyView] Invalid container element');
      return;
    }
    
    try {
      this.container = container;
      this._createDOM();
      this.applyLayout();
      this._initTextStateMachine();
      this.mounted = true;
      
      console.log('[ChazyView] Mounted');
    } catch (error) {
      console.error('[ChazyView] Error during mount:', error);
      this.mounted = false;
    }
  }
  
  unmount(): void {
    if (!this.mounted) return;
    
    try {
      if (this.textStateMachine && (this.textStateMachine as any).destroy) {
        (this.textStateMachine as any).destroy();
      } else if (this.textStateMachine && this.textStateMachine.interrupt) {
        this.textStateMachine.interrupt();
      }
      
      if (this.elements.wrapper && this.elements.wrapper.parentNode) {
        this.elements.wrapper.remove();
      }
      
      this.mounted = false;
      console.log('[ChazyView] Unmounted');
    } catch (error) {
      console.error('[ChazyView] Error during unmount:', error);
      this.mounted = false;
    }
  }
  
  updateConstraints(constraints: Partial<LayoutConstraints>): void {
    if (this.isApplyingLayout) return;
    this.constraints = { ...this.constraints, ...constraints };
    this.applyLayout();
    
    if (!this.elements?.subtitle) return;
    const hasContent = (this.textStateMachine as any)?.getCurrentFullLine?.() ||
      this.elements.subtitle.textContent.trim().length > 0;
    if (!hasContent) return;
    
    if (this._pendingRefitRafId != null) {
      cancelAnimationFrame(this._pendingRefitRafId);
      this._pendingRefitRafId = null;
    }
    
    this._pendingRefitRafId = requestAnimationFrame(() => {
      this._pendingRefitRafId = null;
      if (!this.isApplyingLayout) this._refitSubtitleToConstraints();
    });
  }
  
  showText(line: string, config: TextConfig): void {
    if (!this.textStateMachine) {
      console.error('[ChazyView] TextStateMachine not initialized');
      return;
    }
    
    if (!line || typeof line !== 'string') {
      console.error('[ChazyView] Invalid line in showText');
      return;
    }
    
    if (!config || typeof config !== 'object') {
      console.error('[ChazyView] Invalid config in showText');
      return;
    }
    
    try {
      (this.textStateMachine as any).processLine(line, config);
    } catch (error) {
      console.error('[ChazyView] Error in showText:', error);
    }
  }
  
  canInterrupt(): boolean {
    return this.textStateMachine ? !!(this.textStateMachine as any).canInterrupt() : true;
  }
  
  interrupt(): boolean {
    return this.textStateMachine ? this.textStateMachine.interrupt() : false;
  }
  
  // ─── Internal Methods ─────────────────────────────────────────────────────
  
  private _createDOM(): void {
    try {
      const wrapper = document.createElement('div');
      wrapper.className = 'chazy-wrapper';
      wrapper.id = 'chazy-wrapper';
      
      const title = document.createElement('div');
      title.className = 'chazy-title';
      title.textContent = this.config.title || 'Principia';
      
      const subtitle = document.createElement('div');
      subtitle.className = 'chazy-subtitle';
      subtitle.style.cursor = 'pointer';
      
      wrapper.appendChild(title);
      wrapper.appendChild(subtitle);
      
      if (!this.container || !this.container.appendChild) {
        throw new Error('Invalid container');
      }
      
      this.container.appendChild(wrapper);
      
      this.elements = { wrapper, title, subtitle };
    } catch (error) {
      console.error('[ChazyView] Error in _createDOM:', error);
      throw error;
    }
  }
  
  private _initTextStateMachine(): void {
    this.textStateMachine = new TextStateMachine(
      this.elements.subtitle as HTMLElement,
      () => this._onSubtitleUpdate()
    );
  }
  
  private _onSubtitleUpdate(): void {
    if (!this.mounted || this.isApplyingLayout) return;
    this._refitSubtitleToConstraints();
  }
  
  private _refitSubtitleToConstraints(): void {
    if (!this.elements?.subtitle || !this.elements.title) {
      console.warn('[ChazyView] Missing elements in _refitSubtitleToConstraints');
      return;
    }
    
    try {
      const { maxFontSize, availableWidth } = this.constraints;
      const { title, subtitle } = this.elements;
      const subtitleFontSize = maxFontSize * this.config.subtitleFontRatio;
      subtitle.style.fontSize = `${subtitleFontSize}px`;
      const opticalCorrection = maxFontSize * this.config.opticalCorrection;
      const subtitleMaxWidth = availableWidth - opticalCorrection;
      subtitle.style.maxWidth = `${subtitleMaxWidth}px`;
      subtitle.offsetHeight;
      const titleWidth = title.getBoundingClientRect().width;
      const idealTitleMatch = titleWidth * this.config.subtitleWidthRatio;
      const targetWidth = Math.min(idealTitleMatch, subtitleMaxWidth);
      const fullLine = (this.textStateMachine as any)?.getCurrentFullLine?.();
      const currentContent = subtitle.textContent.replace(/█/g, '').trim();
      
      if (typeof fullLine === 'string' && fullLine.length > 0) {
        console.log('[ChazyView] Refit using full line:', { 
          fullLineLength: fullLine.length, 
          currentContentLength: currentContent.length,
          fullLine: fullLine.substring(0, 50) + (fullLine.length > 50 ? '...' : ''),
          targetWidth 
        });
        
        const temp = document.createElement('span');
        const cs = window.getComputedStyle(subtitle);
        temp.style.cssText = `position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;font-size:${subtitleFontSize}px;font-family:${cs.fontFamily};font-weight:${cs.fontWeight};text-transform:${cs.textTransform};line-height:${cs.lineHeight};letter-spacing:${cs.letterSpacing};`;
        temp.textContent = fullLine;
        document.body.appendChild(temp);
        this._fitTrackingToWidth(temp, targetWidth);
        const newLetterSpacing = temp.style.letterSpacing;
        const newFontSize = temp.style.fontSize;
        temp.remove();
        
        if (newLetterSpacing && newLetterSpacing !== cs.letterSpacing) {
          subtitle.style.letterSpacing = newLetterSpacing;
        }
        if (newFontSize && newFontSize !== cs.fontSize) {
          subtitle.style.fontSize = newFontSize;
        }
      } else {
        console.log('[ChazyView] Refit using current DOM:', { 
          currentContentLength: currentContent.length,
          fullLineAvailable: !!fullLine,
          targetWidth 
        });
        this._fitTrackingToWidth(subtitle, targetWidth);
      }
    } catch (error) {
      console.error('[ChazyView] Error in _refitSubtitleToConstraints:', error);
    }
  }
  
  applyLayout(): void {
    if (this.isApplyingLayout) return;
    this.isApplyingLayout = true;
    
    if (!this.elements || !this.elements.title || !this.elements.subtitle) {
      console.warn('[ChazyView] Missing elements in applyLayout');
      this.isApplyingLayout = false;
      return;
    }
    
    try {
      const { maxFontSize, availableWidth } = this.constraints;
      const { title, subtitle } = this.elements;
      
      const titleTransition = title.style.transition;
      title.style.transition = 'none';
      title.style.fontSize = `${maxFontSize}px`;
      title.offsetHeight;
      const titleWidth = title.getBoundingClientRect().width;
      title.style.transition = titleTransition;
      
      const subtitleFontSize = maxFontSize * this.config.subtitleFontRatio;
      subtitle.style.fontSize = `${subtitleFontSize}px`;
      
      const gapPx = Math.round(maxFontSize * this.config.gapRatio);
      subtitle.style.marginTop = `${gapPx}px`;
      
      const opticalCorrection = maxFontSize * this.config.opticalCorrection;
      subtitle.style.marginLeft = `${opticalCorrection}px`;
      
      const subtitleMaxWidth = availableWidth - opticalCorrection;
      subtitle.style.maxWidth = `${subtitleMaxWidth}px`;
      
      const idealTitleMatch = titleWidth * this.config.subtitleWidthRatio;
      const targetWidth = Math.min(idealTitleMatch, subtitleMaxWidth);
      
      const fullLine = (this.textStateMachine as any)?.getCurrentFullLine?.();
      const hasContent = subtitle.textContent.trim().length > 0;
      if (!hasContent || !fullLine) {
        this._fitTrackingToWidth(subtitle, targetWidth);
      }
      
      console.log('[ChazyView] Layout applied:', { 
        maxFontSize, 
        subtitleFontSize,
        availableWidth, 
        titleWidth, 
        subtitleMaxWidth,
        targetWidth,
        gapPx, 
        opticalCorrection 
      });
    } catch (error) {
      console.error('[ChazyView] Error in applyLayout:', error);
    } finally {
      this.isApplyingLayout = false;
    }
  }
  
  private _fitTrackingToWidth(el: HTMLElement, targetW: number): void {
    if (!el || !(el instanceof HTMLElement)) {
      console.warn('[ChazyView] Invalid element in _fitTrackingToWidth');
      return;
    }
    
    if (typeof targetW !== 'number' || targetW <= 0) {
      console.warn('[ChazyView] Invalid targetW in _fitTrackingToWidth:', targetW);
      return;
    }
    
    try {
      const originalFontSize = parseFloat(window.getComputedStyle(el).fontSize);
      
      if (!originalFontSize || isNaN(originalFontSize)) {
        console.warn('[ChazyView] Could not determine font size');
        return;
      }
      
      const widthAt = (em: number): number => {
        el.style.letterSpacing = `${em}em`;
        return el.getBoundingClientRect().width;
      };
      
      const w0 = widthAt(0.02);
      if (w0 <= 0) return;
      
      const minWidth = widthAt(0.00);
      if (minWidth > targetW) {
        el.style.letterSpacing = "0em";
        const scaleFactor = targetW / minWidth;
        const newFontSize = originalFontSize * scaleFactor;
        el.style.fontSize = `${newFontSize}px`;
        return;
      }
      
      if (widthAt(0.50) < targetW) { 
        el.style.letterSpacing = "0.50em"; 
        return; 
      }
      
      let lo = 0.00, hi = 0.50;
      for (let i = 0; i < 22; i++) {
        const mid = (lo + hi) / 2;
        if (widthAt(mid) > targetW) {
          hi = mid;
        } else {
          lo = mid;
        }
      }
      
      el.style.letterSpacing = `${lo}em`;
    } catch (error) {
      console.error('[ChazyView] Error in _fitTrackingToWidth:', error);
    }
  }
}
