/**
 * EditorRegistry - Manages code editor instances
 * Modular system for JSON, WGSL, and other language editors
 */

export interface ValidationError {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Abstract interface for code editors
 * Implementations: JSONEditor, WGSLEditor, etc.
 */
export interface CodeEditor {
  // Lifecycle
  mount(container: HTMLElement): void;
  destroy(): void;
  
  // Content
  getValue(): string;
  setValue(value: string): void;
  
  // State
  focus(): void;
  blur(): void;
  isReadOnly(): boolean;
  setReadOnly(readonly: boolean): void;
  isFocused(): boolean;
  
  // Validation
  validate(): ValidationResult;
  
  // Events
  onChange(callback: (value: string) => void): void;
  onValidationChange(callback: (result: ValidationResult) => void): void;
  onFocus(callback: () => void): void;
  onBlur(callback: () => void): void;
  
  // Editor-specific features
  format?(): void;  // Auto-format (Ctrl+Shift+F)
  getLanguage(): string;
}

/**
 * Factory function type for creating editors
 */
export type EditorFactory = (config?: EditorConfig) => CodeEditor;

export interface EditorConfig {
  language: string;
  theme?: 'light' | 'dark';
  readOnly?: boolean;
  lineNumbers?: boolean;
  autoFormat?: boolean;
  linting?: boolean;
  autocompletion?: boolean;
}

/**
 * Registry for managing editor factories
 */
export class EditorRegistry {
  private _registry: Map<string, EditorFactory>;

  constructor() {
    this._registry = new Map();
  }

  /**
   * Register an editor factory for a language
   */
  register(language: string, factory: EditorFactory): void {
    if (typeof factory !== 'function') {
      throw new Error(`EditorRegistry: factory for "${language}" must be a function`);
    }
    this._registry.set(language, factory);
  }

  /**
   * Create an editor instance for a language
   */
  create(language: string, config?: Omit<EditorConfig, 'language'>): CodeEditor | null {
    const factory = this._registry.get(language);
    if (!factory) {
      console.warn(`[EditorRegistry] No editor registered for language: ${language}`);
      return null;
    }
    return factory({ ...config, language });
  }

  /**
   * Check if an editor is registered
   */
  has(language: string): boolean {
    return this._registry.has(language);
  }

  /**
   * Get all registered languages
   */
  getRegisteredLanguages(): string[] {
    return Array.from(this._registry.keys());
  }

  /**
   * Unregister an editor
   */
  unregister(language: string): void {
    this._registry.delete(language);
  }

  /**
   * Clear all registered editors
   */
  clear(): void {
    this._registry.clear();
  }
}
