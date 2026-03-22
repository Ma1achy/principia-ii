# Code Editor System

A modular, extensible code editor system built on CodeMirror 6.

## Architecture

```
EditorRegistry (manages all editors)
    ↓
CodeMirrorEditor (abstract base class)
    ↓
JSONEditor, WGSLEditor, TypeScriptEditor, etc. (language-specific implementations)
```

## Quick Start

### 1. Register Editors

```typescript
import { EditorRegistry, createJSONEditor, createWGSLEditor } from './ui/editors';

const editorRegistry = new EditorRegistry();

// Register JSON editor
editorRegistry.register('json', createJSONEditor);

// Register WGSL editor
editorRegistry.register('wgsl', createWGSLEditor);
```

### 2. Create an Editor Instance

```typescript
const jsonEditor = editorRegistry.create('json', {
  theme: 'light',
  lineNumbers: true,
  linting: true,
  autoFormat: true,
  autocompletion: true
});
```

### 3. Mount to DOM

```typescript
const container = document.getElementById('my-editor');
jsonEditor.mount(container);
jsonEditor.setValue('{"hello": "world"}');
```

## Adding a New Language Editor

### Step 1: Create the Editor Class

Create a new file `src/ui/editors/MyLanguageEditor.ts`:

```typescript
import { CodeMirrorEditor } from './CodeMirrorEditor.ts';
import type { EditorConfig, ValidationResult } from './EditorRegistry.ts';
import { javascript } from '@codemirror/lang-javascript'; // or your language package
import { linter } from '@codemirror/lint';
import { autocompletion } from '@codemirror/autocomplete';

export class MyLanguageEditor extends CodeMirrorEditor {
  constructor(config: EditorConfig) {
    super(config);
  }

  /**
   * Return language-specific extensions
   * This is the only required method!
   */
  protected getLanguageExtensions(): any[] {
    const extensions = [];
    
    // 1. Add language support (required)
    extensions.push(javascript()); // or your language
    
    // 2. Add linting (optional)
    if (this.config.linting) {
      extensions.push(linter(myCustomLinter));
    }
    
    // 3. Add autocompletion (optional)
    if (this.config.autocompletion) {
      extensions.push(autocompletion({
        override: [myCompletionSource]
      }));
    }
    
    return extensions;
  }

  /**
   * Implement validation (optional)
   */
  validate(): ValidationResult {
    const content = this.getValue();
    // Your validation logic here
    return { valid: true, errors: [] };
  }

  /**
   * Implement formatting (optional)
   */
  format(): void {
    // Your formatting logic here
  }

  /**
   * Return language identifier (required)
   */
  getLanguage(): string {
    return 'mylanguage';
  }
}

/**
 * Factory function (required)
 */
export function createMyLanguageEditor(config?: EditorConfig): MyLanguageEditor {
  return new MyLanguageEditor({ language: 'mylanguage', ...config });
}
```

### Step 2: Export from index.ts

Add to `src/ui/editors/index.ts`:

```typescript
export { MyLanguageEditor, createMyLanguageEditor } from './MyLanguageEditor.ts';
```

### Step 3: Register the Editor

In your app initialization (`main.ts`):

```typescript
import { createMyLanguageEditor } from './ui/editors';

editorRegistry.register('mylanguage', createMyLanguageEditor);
```

### Step 4: Use It!

```typescript
const editor = editorRegistry.create('mylanguage', {
  lineNumbers: true,
  linting: true
});

editor.mount(document.getElementById('editor-container'));
editor.setValue('const x = 42;');
```

## Available Language Packages

CodeMirror 6 has official language packages:

```bash
npm install @codemirror/lang-javascript  # JavaScript/TypeScript
npm install @codemirror/lang-json        # JSON (already installed)
npm install @codemirror/lang-python      # Python
npm install @codemirror/lang-html        # HTML
npm install @codemirror/lang-css         # CSS
npm install @codemirror/lang-cpp         # C++
npm install @codemirror/lang-java        # Java
npm install @codemirror/lang-rust        # Rust
npm install @codemirror/lang-xml         # XML
npm install @codemirror/lang-markdown    # Markdown
npm install @codemirror/lang-sql         # SQL
```

## CodeEditor Interface

All editors implement this interface:

```typescript
interface CodeEditor {
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
  
  // Optional features
  format?(): void;
  getLanguage(): string;
}
```

## Configuration Options

```typescript
interface EditorConfig {
  language: string;          // Language identifier
  theme?: 'light' | 'dark';  // Theme: 'light' = GitHub Light, 'dark' = One Dark
  readOnly?: boolean;        // Read-only mode
  lineNumbers?: boolean;     // Show line numbers (default: true)
  autoFormat?: boolean;      // Enable Ctrl+Shift+F formatting
  linting?: boolean;         // Enable error/warning indicators
  autocompletion?: boolean;  // Enable autocomplete
}
```

## Themes

The system includes two professional themes:

### GitHub Light (default for `theme: 'light'`)
- Full syntax highlighting with VS Code-quality colors
- Inspired by GitHub's code viewer
- Excellent contrast and readability
- Property names, strings, numbers, keywords all distinct colors

### One Dark (for `theme: 'dark'`)
- Popular dark theme from Atom editor
- Rich color palette
- Easy on the eyes for long coding sessions

### Available Theme Packages

You can easily add more themes:

```bash
# Popular community themes
npm install @uiw/codemirror-theme-github          # GitHub Light/Dark (installed)
npm install @codemirror/theme-one-dark            # One Dark (installed)
npm install @uiw/codemirror-theme-vscode          # VS Code
npm install @uiw/codemirror-theme-sublime         # Sublime
npm install @uiw/codemirror-theme-solarized       # Solarized Light/Dark
npm install @uiw/codemirror-theme-dracula         # Dracula
npm install @uiw/codemirror-theme-material        # Material
npm install @uiw/codemirror-theme-nord            # Nord
npm install @uiw/codemirror-theme-monokai         # Monokai
```

Then import and use:

```typescript
import { vscodeDark } from '@uiw/codemirror-theme-vscode';

// In CodeMirrorEditor.ts, add to theme selection:
const theme = this.config.theme === 'vscode' ? vscodeDark : githubLight;
```

## Features Provided by Base Class

`CodeMirrorEditor` automatically provides:

- ✅ Professional themes (GitHub Light, One Dark)
- ✅ Rich syntax highlighting (different colors for keys, values, types)
- ✅ Full CodeMirror 6 setup with `basicSetup`
- ✅ Line numbers, gutters
- ✅ Bracket matching & auto-closing
- ✅ Search & replace (Ctrl+F)
- ✅ Undo/redo
- ✅ Multiple cursors
- ✅ Custom scrollbar integration
- ✅ All standard editor features
- ✅ Event callbacks (onChange, onFocus, etc.)

You only need to provide:
1. Language extensions (`getLanguageExtensions()`)
2. Language identifier (`getLanguage()`)

Everything else is optional!

## Examples

### Minimal Editor (JSON with defaults)

```typescript
export class MinimalJSONEditor extends CodeMirrorEditor {
  protected getLanguageExtensions() {
    return [json()];
  }
  
  getLanguage() {
    return 'json';
  }
}
```

That's it! This gives you a fully functional JSON editor with syntax highlighting.

### Full-Featured Editor (with linting, completion, formatting)

See `JSONEditor.ts` for a complete example with:
- Custom linting
- Autocompletion
- Format on Ctrl+Shift+F
- Validation API

## Advanced: Custom Themes

If you want a custom theme (dark mode, custom colors), extend the base class:

```typescript
import { EditorView } from 'codemirror';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

const myDarkTheme = EditorView.theme({
  '&': {
    backgroundColor: '#1e1e1e',
    color: '#d4d4d4'
  },
  '.cm-gutters': {
    backgroundColor: '#1e1e1e',
    color: '#858585'
  }
  // ... more styling
}, { dark: true });

const myDarkHighlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.keyword, color: '#569cd6' },
  { tag: tags.string, color: '#ce9178' },
  // ... more tags
]));

// Then in getLanguageExtensions():
protected getLanguageExtensions() {
  return [
    javascript(),
    myDarkTheme,
    myDarkHighlighting
  ];
}
```

## Testing

```typescript
// Create editor
const editor = editorRegistry.create('json');
editor.mount(container);

// Set content
editor.setValue('{"test": true}');

// Get content
console.log(editor.getValue());

// Listen for changes
editor.onChange((value) => {
  console.log('Content changed:', value);
});

// Validate
const result = editor.validate();
if (!result.valid) {
  console.error('Validation errors:', result.errors);
}

// Format (if supported)
editor.format?.();

// Cleanup
editor.destroy();
```

## Summary

- **Simple**: Extend `CodeMirrorEditor`, implement one method (`getLanguageExtensions`)
- **Modular**: Each language is a separate class
- **Extensible**: Add any CodeMirror 6 extension
- **Type-safe**: Full TypeScript support
- **Flexible**: Optional features (linting, formatting, completion)
- **Consistent**: Same API for all languages
