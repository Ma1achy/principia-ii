/**
 * CodeMirrorEditor - Base wrapper for CodeMirror 6
 * Provides common functionality for all language-specific editors
 */

import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { lintGutter } from '@codemirror/lint';
import { atomOneLight, oneDark } from './themes.ts';
import type { CodeEditor, EditorConfig, ValidationResult } from './EditorRegistry.ts';


/**
 * Abstract base class for CodeMirror 6 editors
 */
export abstract class CodeMirrorEditor implements CodeEditor {
  protected view: EditorView | null = null;
  protected config: EditorConfig;
  protected themeCompartment: Compartment;
  protected languageCompartment: Compartment;

  constructor(config: EditorConfig) {
    this.config = config;
    this.themeCompartment = new Compartment();
    this.languageCompartment = new Compartment();
  }

  /**
   * Get language-specific extensions
   * Override in subclasses to provide language support
   */
  protected abstract getLanguageExtensions(): any[];

  /**
   * Mount editor to a DOM element
   */
  mount(element: HTMLElement): void {
    if (this.view) {
      throw new Error('Editor already mounted');
    }

    console.log('[CodeMirrorEditor] === STARTING MOUNT ===');
    console.log('[CodeMirrorEditor] Element:', element.id, element.className);
    console.log('[CodeMirrorEditor] Config:', this.config);
    
    console.log('[CodeMirrorEditor] Getting language extensions...');
    const langExtensions = this.getLanguageExtensions();
    console.log('[CodeMirrorEditor] Language extensions received:', langExtensions.length);
    langExtensions.forEach((ext, i) => {
      console.log(`[CodeMirrorEditor]   Extension ${i}:`, ext?.constructor?.name || typeof ext, ext);
    });

    // Build extensions - use basicSetup which includes everything
    console.log('[CodeMirrorEditor] Building editor extensions...');
    
    // Select theme: light (Atom One Light) or dark (One Dark)
    const theme = this.config.theme === 'dark' ? oneDark : atomOneLight;
    
    const extensions = [
      basicSetup,
      theme,
      lintGutter(),
      this.languageCompartment.of(langExtensions),
      // Hide CodeMirror's scrollbar
      EditorView.theme({
        '.cm-scroller': {
          scrollbarWidth: 'none'
        },
        '.cm-scroller::-webkit-scrollbar': {
          display: 'none'
        }
      })
    ];

    console.log('[CodeMirrorEditor] Total extensions assembled:', extensions.length);
    console.log('[CodeMirrorEditor] Extensions:', extensions.map(e => e?.constructor?.name || typeof e));

    console.log('[CodeMirrorEditor] Creating EditorState...');
    const state = EditorState.create({
      doc: '',
      extensions
    });
    console.log('[CodeMirrorEditor] EditorState created');
    console.log('[CodeMirrorEditor] State extensions:', state.facet(EditorState.languageData));

    console.log('[CodeMirrorEditor] Creating EditorView...');
    this.view = new EditorView({
      state,
      parent: element
    });
    
    console.log('[CodeMirrorEditor] EditorView created!');
    console.log('[CodeMirrorEditor] View DOM:', this.view.dom);
    console.log('[CodeMirrorEditor] View DOM classes:', this.view.dom.className);
    
    // Debug: Inspect the DOM immediately
    setTimeout(() => {
      console.log('[CodeMirrorEditor] === POST-MOUNT INSPECTION (100ms) ===');
      const contentArea = this.view?.dom.querySelector('.cm-content');
      if (contentArea) {
        console.log('[CodeMirrorEditor] Content area found');
        console.log('[CodeMirrorEditor] Content innerHTML length:', contentArea.innerHTML.length);
        console.log('[CodeMirrorEditor] Content first 200 chars:', contentArea.innerHTML.substring(0, 200));
        
        const lines = contentArea.querySelectorAll('.cm-line');
        console.log('[CodeMirrorEditor] Lines found:', lines.length);
        
        if (lines.length > 0) {
          const firstLine = lines[0];
          console.log('[CodeMirrorEditor] First line HTML:', firstLine.innerHTML);
          
          const allSpans = firstLine.querySelectorAll('span');
          console.log('[CodeMirrorEditor] Spans in first line:', allSpans.length);
          allSpans.forEach((span, i) => {
            const computed = window.getComputedStyle(span);
            console.log(`[CodeMirrorEditor]   Span ${i}:`, {
              class: span.className,
              text: span.textContent,
              color: computed.color,
              backgroundColor: computed.backgroundColor,
              fontWeight: computed.fontWeight
            });
          });
        }
      } else {
        console.error('[CodeMirrorEditor] Content area NOT found!');
      }
      
      // Check if language data is present
      if (this.view) {
        const lang = this.view.state.facet(EditorState.languageData);
        console.log('[CodeMirrorEditor] Language data facet:', lang);
      }
    }, 100);
    
    // Setup custom scrollbar sync
    this.setupScrollbarSync(element);
    
    console.log('[CodeMirrorEditor] === MOUNT COMPLETE ===');
  }

  /**
   * Setup custom scrollbar synchronization
   */
  private setupScrollbarSync(element: HTMLElement): void {
    if (!this.view) return;
    
    // Find the custom scrollbar (sibling of editor container)
    const wrap = element.parentElement;
    if (!wrap) return;
    
    const scrollbarId = wrap.id.replace('-wrap', '-sb');
    const scrollbar = document.getElementById(scrollbarId);
    if (!scrollbar) return;
    
    const upBtn = scrollbar.querySelector('button:first-child') as HTMLButtonElement;
    const downBtn = scrollbar.querySelector('button:last-child') as HTMLButtonElement;
    const track = scrollbar.querySelector('div') as HTMLDivElement;
    const thumb = track?.querySelector('div') as HTMLDivElement;
    
    if (!upBtn || !downBtn || !track || !thumb) return;
    
    const scroller = this.view.scrollDOM;
    
    // Update thumb position and size based on scroll
    const updateThumb = () => {
      const scrollHeight = scroller.scrollHeight;
      const clientHeight = scroller.clientHeight;
      const scrollTop = scroller.scrollTop;
      
      if (scrollHeight <= clientHeight) {
        thumb.style.display = 'none';
        return;
      }
      
      thumb.style.display = 'block';
      const thumbHeight = (clientHeight / scrollHeight) * track.clientHeight;
      const thumbTop = (scrollTop / scrollHeight) * track.clientHeight;
      
      thumb.style.height = `${thumbHeight}px`;
      thumb.style.top = `${thumbTop}px`;
    };
    
    // Scroll event
    scroller.addEventListener('scroll', updateThumb);
    
    // Button clicks
    upBtn.addEventListener('click', () => {
      scroller.scrollTop -= 40;
    });
    
    downBtn.addEventListener('click', () => {
      scroller.scrollTop += 40;
    });
    
    // Track click
    track.addEventListener('click', (e) => {
      if (e.target === thumb) return;
      const rect = track.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      const scrollRatio = clickY / track.clientHeight;
      scroller.scrollTop = scrollRatio * scroller.scrollHeight;
    });
    
    // Thumb drag
    let isDragging = false;
    let startY = 0;
    let startScrollTop = 0;
    
    thumb.addEventListener('mousedown', (e) => {
      isDragging = true;
      startY = e.clientY;
      startScrollTop = scroller.scrollTop;
      e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const deltaY = e.clientY - startY;
      const scrollRatio = deltaY / track.clientHeight;
      scroller.scrollTop = startScrollTop + (scrollRatio * scroller.scrollHeight);
    });
    
    document.addEventListener('mouseup', () => {
      isDragging = false;
    });
    
    // Initial update
    updateThumb();
    
    // Update on resize
    const resizeObserver = new ResizeObserver(updateThumb);
    resizeObserver.observe(scroller);
    
    // Mouse wheel support
    scroller.addEventListener('wheel', (e) => {
      e.preventDefault();
      scroller.scrollTop += e.deltaY;
      scroller.scrollLeft += e.deltaX;
    }, { passive: false });
    
    // Horizontal scrollbar setup
    const hScrollbar = document.getElementById('stateBox-sb-horizontal');
    if (hScrollbar) {
      const hLeftBtn = hScrollbar.querySelector('button:first-child') as HTMLButtonElement;
      const hRightBtn = hScrollbar.querySelector('button:last-child') as HTMLButtonElement;
      const hTrack = hScrollbar.querySelector('div') as HTMLDivElement;
      const hThumb = hTrack?.querySelector('div') as HTMLDivElement;
      
      if (hLeftBtn && hRightBtn && hTrack && hThumb) {
        const updateHThumb = () => {
          const scrollWidth = scroller.scrollWidth;
          const clientWidth = scroller.clientWidth;
          const scrollLeft = scroller.scrollLeft;
          
          const wrap = element.parentElement;
          
          if (scrollWidth <= clientWidth) {
            // Hide entire horizontal scrollbar when not needed
            hScrollbar.style.display = 'none';
            // Adjust grid to remove scrollbar row
            if (wrap) {
              wrap.style.gridTemplateRows = '1fr 0';
            }
            return;
          }
          
          // Show horizontal scrollbar when needed
          hScrollbar.style.display = 'flex';
          // Adjust grid to show scrollbar row
          if (wrap) {
            wrap.style.gridTemplateRows = '1fr 20px';
          }
          
          hThumb.style.display = 'block';
          const thumbWidth = (clientWidth / scrollWidth) * hTrack.clientWidth;
          const thumbLeft = (scrollLeft / scrollWidth) * hTrack.clientWidth;
          
          hThumb.style.width = `${thumbWidth}px`;
          hThumb.style.left = `${thumbLeft}px`;
        };
        
        scroller.addEventListener('scroll', updateHThumb);
        
        hLeftBtn.addEventListener('click', () => {
          scroller.scrollLeft -= 40;
        });
        
        hRightBtn.addEventListener('click', () => {
          scroller.scrollLeft += 40;
        });
        
        hTrack.addEventListener('click', (e) => {
          if (e.target === hThumb) return;
          const rect = hTrack.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const scrollRatio = clickX / hTrack.clientWidth;
          scroller.scrollLeft = scrollRatio * scroller.scrollWidth;
        });
        
        let isHDragging = false;
        let startX = 0;
        let startScrollLeft = 0;
        
        hThumb.addEventListener('mousedown', (e) => {
          isHDragging = true;
          startX = e.clientX;
          startScrollLeft = scroller.scrollLeft;
          e.preventDefault();
        });
        
        document.addEventListener('mousemove', (e) => {
          if (!isHDragging) return;
          const deltaX = e.clientX - startX;
          const scrollRatio = deltaX / hTrack.clientWidth;
          scroller.scrollLeft = startScrollLeft + (scrollRatio * scroller.scrollWidth);
        });
        
        document.addEventListener('mouseup', () => {
          isHDragging = false;
        });
        
        updateHThumb();
        resizeObserver.observe(scroller);
      }
    }
  }

  /**
   * Unmount editor from DOM
   */
  unmount(): void {
    if (this.view) {
      this.view.destroy();
      this.view = null;
    }
  }

  /**
   * Get current editor value
   */
  getValue(): string {
    if (!this.view) {
      throw new Error('Editor not mounted');
    }
    return this.view.state.doc.toString();
  }

  /**
   * Set editor value
   */
  setValue(value: string): void {
    console.log('[CodeMirrorEditor] === SET VALUE ===');
    console.log('[CodeMirrorEditor] Value length:', value.length);
    console.log('[CodeMirrorEditor] First 100 chars:', value.substring(0, 100));
    
    if (!this.view) {
      throw new Error('Editor not mounted');
    }

    this.view.dispatch({
      changes: {
        from: 0,
        to: this.view.state.doc.length,
        insert: value
      }
    });
    
    console.log('[CodeMirrorEditor] Dispatch complete');
    
    // Debug after setValue
    setTimeout(() => {
      console.log('[CodeMirrorEditor] === POST-SETVALUE INSPECTION (200ms) ===');
      if (this.view) {
        const content = this.view.dom.querySelector('.cm-content');
        if (content) {
          const lines = content.querySelectorAll('.cm-line');
          console.log('[CodeMirrorEditor] Total lines after setValue:', lines.length);
          
          if (lines.length > 1) {
            // Check line 2 which should have "v": 1 or similar
            const line2 = lines[1];
            console.log('[CodeMirrorEditor] Line 2 HTML:', line2.innerHTML);
            console.log('[CodeMirrorEditor] Line 2 text:', line2.textContent);
            
            const spans = line2.querySelectorAll('span');
            console.log('[CodeMirrorEditor] Line 2 spans:', spans.length);
            spans.forEach((span, i) => {
              const computed = window.getComputedStyle(span);
              console.log(`[CodeMirrorEditor]   Line 2 Span ${i}:`, {
                class: span.className,
                text: span.textContent,
                color: computed.color,
                allClasses: Array.from(span.classList)
              });
            });
          }
        }
      }
    }, 200);
  }

  /**
   * Check if editor has focus
   */
  hasFocus(): boolean {
    return this.view?.hasFocus ?? false;
  }

  /**
   * Focus the editor
   */
  focus(): void {
    this.view?.focus();
  }

  /**
   * Blur the editor
   */
  blur(): void {
    this.view?.contentDOM.blur();
  }

  /**
   * Check if editor is read-only
   */
  isReadOnly(): boolean {
    return this.config.readOnly || false;
  }

  /**
   * Set read-only state
   */
  setReadOnly(readonly: boolean): void {
    if (!this.view) return;
    this.config.readOnly = readonly;
    // Note: Would need a readOnly compartment to dynamically update this
  }

  /**
   * Check if editor is focused
   */
  isFocused(): boolean {
    return this.hasFocus();
  }

  /**
   * Get language identifier
   */
  getLanguage(): string {
    return this.config.language || 'unknown';
  }

  /**
   * Register change callback
   */
  onChange(callback: (value: string) => void): void {
    // Would need to add update listener extension in mount()
  }

  /**
   * Register validation change callback
   */
  onValidationChange(callback: (result: ValidationResult) => void): void {
    // Would need to add validation listener
  }

  /**
   * Register focus callback
   */
  onFocus(callback: () => void): void {
    // Would need to add focus listener
  }

  /**
   * Register blur callback
   */
  onBlur(callback: () => void): void {
    // Would need to add blur listener
  }

  /**
   * Destroy editor and clean up
   */
  destroy(): void {
    this.unmount();
  }

  /**
   * Get theme extensions based on config
   */
  protected getThemeExtensions(): any[] {
    return [];
  }

  /**
   * Validate current content
   * Override in subclasses for language-specific validation
   */
  abstract validate(): ValidationResult;

  /**
   * Format current content
   * Override in subclasses for language-specific formatting
   */
  abstract format(): void;
}
