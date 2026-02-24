# Button Label System

This directory contains the button label system for randomized UI text across the **entire application**.

## Architecture

```
content/
├── ContentPool.js           # Selection engine
├── pools/
│   ├── button-labels.js     # Button label pools (ALL buttons, not just dialogs)
│   └── tooltip-pools.js     # (Future) Tooltip content pools
└── README.md                # This file
```

## Core Concept

This system provides **randomized labels for ANY button** in the application:
- Dialog buttons (welcome, warnings, confirmations)
- Control panel buttons (render, reset, etc.)
- Toolbar buttons
- Any UI button that needs text variation

## Defensive Programming

**IMPORTANT:** Every button using a pool MUST have a hardcoded `label` fallback:

```javascript
buttons: [
  {
    id: 'confirm',
    labelPoolId: 'welcome_confirm',  // Pool for randomization
    label: 'CONTINUE',  // ✅ MANDATORY fallback
    role: 'primary'
  }
]
```

This ensures buttons always display something, even if:
- Pool file fails to load
- Pool ID is typo'd  
- ContentPool instance is missing
- Exception occurs during selection

**Never do this:**
```javascript
buttons: [
  {
    id: 'confirm',
    labelPoolId: 'welcome_confirm',
    // ❌ NO FALLBACK - button could be blank!
    role: 'primary'
  }
]
```

## Usage

### Declarative API (Recommended)

The cleanest way to use randomized labels is through the declarative API.

**For Dialogs:**

```javascript
import { showDialog } from '../dialogs/dialog.js';
import { ContentPool } from '../content/ContentPool.js';
import { BUTTON_LABEL_POOLS } from '../content/pools/button-labels.js';

// Create shared pool instance (one per session)
const contentPool = new ContentPool(BUTTON_LABEL_POOLS);

// Use declaratively in dialog
showDialog({
  id: 'welcome',
  title: 'WELCOME',
  contentPool: contentPool,  // Pass pool instance
  buttons: [
    {
      id: 'confirm',
      labelPoolId: 'welcome_confirm',  // Pool ID for randomization
      label: 'CONTINUE',  // ✅ MANDATORY fallback
      role: 'primary'
    }
  ]
});
```

**For Any UI Button:**

The same ContentPool instance can be used for ANY button in your application:

```javascript
import { contentPool } from '../somewhere/shared.js';

// Control panel render button
const renderBtn = document.getElementById('renderBtn');
renderBtn.textContent = contentPool.select('render_button', {
  fallback: 'RENDER'  // ✅ Always provide fallback
});

// Toolbar reset button
const resetBtn = document.getElementById('resetBtn');
resetBtn.textContent = contentPool.select('reset_button', {
  fallback: 'RESET'  // ✅ Always provide fallback
});
```

```javascript
import { ContentPool } from '../content/ContentPool.js';
import { DIALOG_LABEL_POOLS } from '../content/pools/dialog-labels.js';

// Create pool instance
const pool = new ContentPool(DIALOG_LABEL_POOLS);

// Select a label (session-sticky by default)
const label = pool.select('welcome_confirm');

// Use in dialog (manual approach)
showDialog({
  id: 'welcome',
  title: 'WELCOME',
  buttons: [
    {
      id: 'confirm',
      label: label,  // Manually selected
      role: 'primary'
    }
  ]
});
```

**Note:** The declarative API (above) is preferred as it handles errors more gracefully.

### Advanced Options

```javascript
// Disable session caching (select new text each time)
const label = pool.select('welcome_confirm', { session: false });

// Disable no-repeat protection
const label = pool.select('welcome_confirm', { noRepeat: false });

// Custom RNG (for testing/debugging)
const pool = new ContentPool(DIALOG_LABEL_POOLS, {
  rng: () => 0.5,  // Deterministic selection
  noRepeatLast: 10  // Avoid last 10 selections
});
```

### Pool Management

```javascript
// Check current selection
const current = pool.peek('welcome_confirm');  // Returns null if not cached

// Reset session cache
pool.resetSession('welcome_confirm');  // Specific pool
pool.resetSession();                   // All pools

// Clear history (no-repeat tracking)
pool.clearHistory('welcome_confirm');
pool.clearHistory();

// Full reset (cache + history)
pool.invalidate('welcome_confirm');
pool.invalidate();

// Get statistics
const stats = pool.getStats('welcome_confirm');
console.log(stats);
// {
//   poolId: 'welcome_confirm',
//   description: 'Button labels for welcome dialog confirmation',
//   totalEntries: 132,
//   recentCount: 5,
//   recentIds: ['accept_reduction', 'chaos_vram', ...],
//   cachedSelection: 'MAKE CHAOS FIT IN VRAM',
//   hasCached: true
// }
```

## Pool Schema

### Pool Definition

```javascript
{
  id: string;           // Pool identifier
  description: string;  // Human-readable description
  entries: [            // Array of selectable entries
    {
      id: string;       // Unique entry identifier
      text: string;     // Display text
      weight?: number;  // Selection weight (default 1.0)
      kind?: string;    // Classification (e.g. 'formal', 'humorous')
      when?: {          // Conditional matching (future)
        emotion?: string[];
        mobile?: boolean;
        firstTime?: boolean;
      }
    }
  ]
}
```

### Weight System

Weights control selection probability:
- **1.0** - Baseline (default)
- **< 1.0** - Less likely (e.g. 0.5 = half as likely)
- **> 1.0** - More likely (e.g. 2.0 = twice as likely)

Example: If you want humorous entries to appear more often, give them weight 1.5.

## Features

### Session-Sticky Caching

By default, once a label is selected, it stays the same for the entire session:

```javascript
const pool = new ContentPool(DIALOG_LABEL_POOLS);

pool.select('welcome_confirm');  // "MAKE CHAOS FIT IN VRAM"
pool.select('welcome_confirm');  // "MAKE CHAOS FIT IN VRAM" (same)
pool.select('welcome_confirm');  // "MAKE CHAOS FIT IN VRAM" (same)
```

This prevents the button label from changing unexpectedly if the dialog is shown multiple times.

### No-Repeat Protection

The pool tracks recent selections and avoids repeating them:

```javascript
// With default noRepeatLast: 5
pool.select('welcome_confirm', { session: false });  // "ACCEPT THE REDUCTION"
pool.select('welcome_confirm', { session: false });  // "CHAOS IN VRAM" (won't repeat recent)
pool.select('welcome_confirm', { session: false });  // "ENTER THE SLICE" (won't repeat recent)
```

### Weighted Selection

Entries with higher weights are more likely to be selected:

```javascript
entries: [
  { id: 'formal', text: 'ACCEPT', weight: 1.0 },       // 20% chance
  { id: 'humorous', text: 'DO CRIMES', weight: 4.0 }   // 80% chance
]
```

## Adding New Pools

### Dialog Labels

Add new pools to `pools/dialog-labels.js`:

```javascript
export const DIALOG_LABEL_POOLS = {
  welcome_confirm: { /* existing */ },
  
  // New pool
  gpu_warning_confirm: {
    id: 'gpu_warning_confirm',
    description: 'Button labels for GPU warning dialog',
    entries: [
      { id: 'proceed', text: 'PROCEED ANYWAY', weight: 1.0, kind: 'formal' },
      { id: 'risk_it', text: 'RISK IT', weight: 1.2, kind: 'conversational' },
      { id: 'unleash', text: 'UNLEASH THE GPU', weight: 1.5, kind: 'humorous' }
    ]
  }
};
```

### Tooltip Pools (Future)

Create `pools/tooltip-pools.js` with similar structure:

```javascript
export const TOOLTIP_POOLS = {
  render_button: {
    id: 'render_button',
    description: 'Tooltips for render button',
    entries: [
      {
        id: 'basic',
        text: 'Compute texture from current parameters',
        weight: 1.0,
        kind: 'technical'
      },
      {
        id: 'poetic',
        text: 'Render the slice of destiny',
        weight: 1.2,
        kind: 'poetic'
      }
    ]
  }
};
```

## Testing

### Deterministic Selection

For testing, you can inject a deterministic RNG:

```javascript
// Seeded random (example implementation)
function seededRandom(seed) {
  return function() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

const pool = new ContentPool(DIALOG_LABEL_POOLS, {
  rng: seededRandom(12345)
});

// Now selections are deterministic and reproducible
pool.select('welcome_confirm');  // Always returns same result for seed 12345
```

### Test Case Example

```javascript
// Test that humorous labels are selected more often
const pool = new ContentPool(DIALOG_LABEL_POOLS);
const results = new Map();

for (let i = 0; i < 1000; i++) {
  pool.resetSession();
  const label = pool.select('welcome_confirm');
  results.set(label, (results.get(label) || 0) + 1);
}

// Verify humorous entries (weight 1.5) appear ~1.5x more than formal (weight 1.0)
```

## Design Principles

1. **Session-sticky by default** - Prevents jarring label changes
2. **Weighted randomization** - Control distribution without hard-coding
3. **No-repeat protection** - Prevents boring repetition
4. **Deterministic testing** - Inject RNG for reproducibility
5. **Type-safe with JSDoc** - Full IDE autocomplete
6. **Tree-shakable** - Only import what you use
7. **No async loading** - Instant, synchronous access

## Future Enhancements

- Context-aware filtering (`when` conditions)
- Multi-language support
- Dynamic pool updates
- Analytics integration (track popular labels)
- A/B testing support

---

For implementation details, see `DIALOG_TOOLTIP_SYSTEM.md` in the project root.
