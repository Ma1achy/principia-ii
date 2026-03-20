/**
 * StateBox Editor Manager
 * Singleton for managing the State JSON editor instance
 */

import type { CodeEditor } from './EditorRegistry.ts';

let editorInstance: CodeEditor | null = null;

/**
 * Initialize the stateBox editor
 */
export function initStateBoxEditor(editor: CodeEditor): void {
  editorInstance = editor;
  console.log('[StateBoxEditor] Editor instance registered');
}

/**
 * Get the stateBox editor instance
 */
export function getStateBoxEditor(): CodeEditor | null {
  return editorInstance;
}

/**
 * Update stateBox content (works with both textarea and CodeMirror)
 */
export function setStateBoxValue(value: string): void {
  if (editorInstance) {
    // Use CodeMirror editor
    editorInstance.setValue(value);
  } else {
    // Fallback to textarea (during initialization)
    const textarea = document.getElementById('stateBox') as HTMLTextAreaElement;
    if (textarea) {
      textarea.value = value;
    }
  }
}

/**
 * Get stateBox content (works with both textarea and CodeMirror)
 */
export function getStateBoxValue(): string {
  if (editorInstance) {
    // Use CodeMirror editor
    return editorInstance.getValue();
  } else {
    // Fallback to textarea
    const textarea = document.getElementById('stateBox') as HTMLTextAreaElement;
    return textarea?.value || '';
  }
}

/**
 * Cleanup editor
 */
export function destroyStateBoxEditor(): void {
  if (editorInstance) {
    editorInstance.destroy();
    editorInstance = null;
  }
}
