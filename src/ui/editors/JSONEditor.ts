/**
 * JSONEditor - CodeMirror 6 wrapper for JSON editing
 * Features: syntax highlighting, linting, auto-formatting, autocompletion
 */

import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter } from '@codemirror/lint';
import { keymap } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { autocompletion } from '@codemirror/autocomplete';
import { CodeMirrorEditor } from './CodeMirrorEditor.ts';
import type { ValidationResult, EditorConfig } from './EditorRegistry.ts';

/**
 * JSON editor with validation and formatting
 */
export class JSONEditor extends CodeMirrorEditor {
  constructor(config: EditorConfig) {
    super(config);
  }

  protected getLanguageExtensions(): any[] {
    console.log('[JSONEditor] === BUILDING LANGUAGE EXTENSIONS ===');
    console.log('[JSONEditor] Config:', JSON.stringify(this.config));
    
    // Use the full json() which includes parser + default highlighting
    console.log('[JSONEditor] Importing json() from @codemirror/lang-json...');
    const jsonLang = json();
    console.log('[JSONEditor] json() returned:', jsonLang);
    console.log('[JSONEditor] json() type:', typeof jsonLang);
    console.log('[JSONEditor] json() constructor:', jsonLang?.constructor?.name);
    
    const extensions = [jsonLang];
    console.log('[JSONEditor] Added JSON language support');

    if (this.config.autocompletion) {
      const ac = autocompletion();
      extensions.push(ac);
      console.log('[JSONEditor] Added autocompletion:', ac);
    }

    if (this.config.linting) {
      console.log('[JSONEditor] Creating linter with jsonParseLinter()...');
      const jsonLinter = linter(jsonParseLinter());
      console.log('[JSONEditor] Linter created:', jsonLinter);
      extensions.push(jsonLinter);
      console.log('[JSONEditor] Added built-in JSON linter');
    }

    const km = keymap.of([
      ...defaultKeymap,
      indentWithTab,
      {
        key: 'Mod-Shift-f',
        run: () => {
          this.format();
          return true;
        }
      }
    ]);
    extensions.push(km);
    console.log('[JSONEditor] Added keymaps');

    console.log('[JSONEditor] === LANGUAGE EXTENSIONS COMPLETE ===');
    console.log('[JSONEditor] Total extensions:', extensions.length);
    extensions.forEach((ext, i) => {
      console.log(`[JSONEditor]   ${i}:`, ext?.constructor?.name || typeof ext, ext);
    });
    
    return extensions;
  }

  private createJSONLinter() {
    console.log('[JSONEditor] Creating JSON linter...');
    return linter((view) => {
      const diagnostics: Diagnostic[] = [];
      const text = view.state.doc.toString();

      try {
        JSON.parse(text);
        console.log('[JSONEditor] JSON is valid');
      } catch (e: any) {
        console.log('[JSONEditor] JSON parse error:', e.message);
        
        // Try to extract line number from error message
        let pos = 0;
        const lineMatch = e.message.match(/line (\d+)/);
        const colMatch = e.message.match(/column (\d+)/);
        
        if (lineMatch && colMatch) {
          const lineNum = parseInt(lineMatch[1], 10);
          const colNum = parseInt(colMatch[1], 10);
          console.log('[JSONEditor] Extracted line:', lineNum, 'column:', colNum);
          
          // Convert line/column to position
          const lines = text.split('\n');
          pos = 0;
          for (let i = 0; i < lineNum - 1 && i < lines.length; i++) {
            pos += lines[i].length + 1; // +1 for newline
          }
          pos += colNum - 1;
          console.log('[JSONEditor] Calculated position:', pos);
        } else {
          // Fallback to position match
          const match = e.message.match(/position (\d+)/);
          pos = match ? parseInt(match[1], 10) : 0;
        }

        diagnostics.push({
          from: pos,
          to: Math.min(pos + 1, text.length),
          severity: 'error',
          message: e.message
        });
        console.log('[JSONEditor] Added diagnostic at position', pos);
      }

      console.log('[JSONEditor] Returning', diagnostics.length, 'diagnostics');
      return diagnostics;
    });
  }

  validate(): ValidationResult {
    const content = this.getValue();
    try {
      JSON.parse(content);
      return { valid: true, errors: [] };
    } catch (e: any) {
      return {
        valid: false,
        errors: [{ message: e.message, line: 0, column: 0, severity: 'error' }]
      };
    }
  }

  format(): void {
    if (!this.view) return;

    const content = this.getValue();
    try {
      const parsed = JSON.parse(content);
      const formatted = JSON.stringify(parsed, null, 2);
      this.setValue(formatted);
    } catch (e) {
      console.error('[JSONEditor] Cannot format invalid JSON:', e);
    }
  }

  getLanguage(): string {
    return 'json';
  }
}

/**
 * Factory function for creating JSON editors
 */
export function createJSONEditor(config?: EditorConfig): JSONEditor {
  return new JSONEditor({ language: 'json', ...config });
}
