# Z-Index Layer System

## Overview

Principia uses a **centralized, stack-based z-index management system** to ensure proper layering of UI components. This system eliminates hardcoded z-index values and provides automatic layer management based on the navigation stack depth.

## Architecture

### Core Principles

1. **Layer Spacing**: Each navigation stack level gets 1000 z-index units
2. **Stack-Based**: Z-index is calculated from navigation stack depth
3. **CSS Variables**: All components use CSS custom properties
4. **Tooltip Priority**: Tooltips always render at maximum z-index (100000)

### Layer Hierarchy

```
Z-Index Range   | Component Type          | Stack Depth
----------------|-------------------------|-------------
0-99            | Background elements     | N/A
100-999         | Main content            | N/A  
1000-1999       | Sidebar & fixed UI      | 1 (base)
2000-2999       | First overlay/dialog    | 2
3000-3999       | Nested overlay          | 3
4000-4999       | Second nested overlay   | 4
...             | ...                     | ...
100000+         | Tooltips (always top)   | N/A
```

### Z-Index Calculation

- **Overlay**: `stackDepth × 1000`
- **Cursor**: `stackDepth × 1000 + 500`
- **Tooltip**: `100000` (constant)

## Usage

### In JavaScript

```javascript
import { ZIndex } from './ui/core/z-index.js';

// For overlays/dialogs
element.style.zIndex = String(ZIndex.forOverlay());

// For cursor (automatic, handled by FocusVisualizer)
const cursorZ = ZIndex.forCursor();

// For tooltips
element.style.zIndex = String(ZIndex.forTooltip());

// For sidebar
element.style.zIndex = String(ZIndex.forSidebar());
```

### In CSS

Use CSS custom properties that are automatically updated:

```css
/* Dialog overlay */
.dialog-overlay {
  z-index: var(--z-overlay-current, 2000);
}

/* Tooltips */
.tooltip {
  z-index: var(--z-tooltip, 100000);
}

/* Sidebar */
#sidebar {
  z-index: var(--z-sidebar, 1000);
}

/* Cursor (handled automatically) */
.nav-cursor {
  z-index: var(--z-cursor-current, 1500);
}
```

## How It Works

### 1. Stack Depth Tracking

The `KeyboardNavigationManager` updates the global z-index system whenever the navigation stack changes:

```javascript
this.navStack = new NavigationStack((frame) => {
  this.stackRenderer.render(frame);
  
  // Update z-index system
  ZIndex.setStackDepth(this.navStack.depth());
  ZIndex.updateCSSVariables();
});
```

### 2. CSS Variable Updates

When stack depth changes, CSS variables are automatically updated:

- `--z-overlay-current`: Current overlay z-index
- `--z-cursor-current`: Current cursor z-index
- `--z-tooltip`: Tooltip z-index (constant)
- `--z-sidebar`: Sidebar z-index (constant)

### 3. Dynamic Layering

Components automatically adjust their z-index based on the current navigation state:

- Root level (stack depth 1): z-index 1000
- Open dialog (stack depth 2): z-index 2000
- Open picker within dialog (stack depth 3): z-index 3000

## Benefits

### Before (Hardcoded)

```css
.dialog-overlay { z-index: 10000; }
.picker-overlay { z-index: 200; }
.nav-cursor { z-index: 999999; }
.tooltip { z-index: 9999; }
```

**Problems:**
- Cursor covers tooltips
- Inconsistent layer hierarchy
- Dialogs and pickers have conflicting z-indexes
- No relationship to actual UI structure

### After (Stack-Based)

```css
.dialog-overlay { z-index: var(--z-overlay-current); }
.picker-overlay { z-index: var(--z-overlay-current); }
.nav-cursor { z-index: var(--z-cursor-current); }
.tooltip { z-index: var(--z-tooltip); }
```

**Benefits:**
- Tooltips always on top
- Proper layer hierarchy
- Z-index reflects actual UI structure
- Automatic management

## Migration Guide

### For New Components

1. Import the z-index system:
   ```javascript
   import { ZIndex } from '../core/z-index.js';
   ```

2. Use the appropriate function:
   ```javascript
   overlay.style.zIndex = String(ZIndex.forOverlay());
   ```

3. Or use CSS variables:
   ```css
   .my-overlay {
     z-index: var(--z-overlay-current, 2000);
   }
   ```

### For Existing Components

Replace hardcoded z-index values with CSS variables:

**Before:**
```css
#myDialog {
  z-index: 10000;
}
```

**After:**
```css
#myDialog {
  z-index: var(--z-overlay-current, 2000);
}
```

## API Reference

### Functions

- `ZIndex.forOverlay(depth?)` - Z-index for overlay at given depth
- `ZIndex.forCursor(depth?)` - Z-index for navigation cursor
- `ZIndex.forTooltip()` - Z-index for tooltips (always 100000)
- `ZIndex.forSidebar()` - Z-index for sidebar (always 1000)
- `ZIndex.forContent()` - Z-index for main content (always 100)
- `ZIndex.setStackDepth(depth)` - Update current stack depth
- `ZIndex.getStackDepth()` - Get current stack depth
- `ZIndex.updateCSSVariables()` - Update CSS custom properties

### CSS Variables

- `--z-overlay-current` - Current overlay z-index (dynamic)
- `--z-cursor-current` - Current cursor z-index (dynamic)
- `--z-tooltip` - Tooltip z-index (100000)
- `--z-sidebar` - Sidebar z-index (1000)
- `--z-content` - Content z-index (100)
- `--z-background` - Background z-index (0)

## Examples

### Opening a Dialog

```javascript
// Navigation manager pushes dialog onto stack (depth becomes 2)
navManager.openOverlay('dialog-confirm', triggerElementId, 'dialog');

// Z-index system automatically updates:
// - Dialog overlay: z-index 2000
// - Cursor: z-index 2500
// - Tooltips: z-index 100000 (always on top)
```

### Nested Overlays

```javascript
// Stack depth 1: Base UI (z-index 1000)
// Open settings panel -> Stack depth 2 (z-index 2000)
// Open picker within settings -> Stack depth 3 (z-index 3000)
// Cursor always at current depth + 500
// Tooltips always at 100000
```

## Testing

To verify the z-index system is working:

1. Open a dialog - cursor should be visible above dialog content
2. Hover over an element with a tooltip - tooltip should appear above cursor
3. Open a nested overlay - cursor should move to new layer
4. Close overlay - cursor should return to previous layer

## Troubleshooting

### Cursor covers tooltip

- Check that tooltip uses `var(--z-tooltip, 100000)`
- Verify CSS variables are being updated
- **For CodeMirror tooltips**: The tooltip z-index fixer should be initialized via `initTooltipZIndexFixer()`

### Overlay appears behind sidebar

- Ensure overlay uses `var(--z-overlay-current)`
- Check that stack depth is updating correctly

### Z-index not updating

- Verify `ZIndex.updateCSSVariables()` is called on stack changes
- Check browser console for JavaScript errors

### CodeMirror Tooltips Not Working

CodeMirror tooltips are created dynamically with inline styles that may override CSS. The system includes a `tooltip-z-index-fixer.ts` module that:

1. Watches for tooltip creation with a MutationObserver
2. Applies the correct z-index (100000) with `!important` via inline styles
3. Ensures tooltips always appear above the cursor

**Usage:**
```javascript
import { initTooltipZIndexFixer } from './ui/editors/tooltip-z-index-fixer.ts';

// Initialize once during app startup
initTooltipZIndexFixer();
```

This is automatically initialized in `main.ts` after the CodeMirror editor is created.
