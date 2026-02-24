# Button Label Pools

Button label pools for randomized button text throughout the application.

## Schema

```json
{
  "pool_id": {
    "description": "Human-readable description",
    "defaultLabel": "FALLBACK TEXT",
    "entries": [
      {
        "text": "DISPLAY TEXT",
        "weight": 1.0,
        "kind": "formal"
      }
    ]
  }
}
```

### Fields

- **pool_id** (key): Unique pool identifier (e.g. `welcome_confirm`)
- **description**: Purpose of this pool
- **defaultLabel**: Backup if loading fails
- **entries**: Array of label variants
  - **text**: Button label (serves as unique identifier)
  - **weight**: Selection probability (1.0 = baseline)
  - **kind**: Category (`formal`, `poetic`, `technical`, `conversational`, `humorous`)

## Weight Guide

- **0.8** - Less common (conversational/resigned)
- **1.0** - Baseline (formal/technical)
- **1.2** - More common (poetic)
- **1.5** - Most common (humorous/fun)

## Usage

```javascript
import { preloadButtonPools } from '../../poolLoader.js';
import { ContentPool } from '../../ContentPool.js';

// Load pools
const pools = await preloadButtonPools();
const pool = new ContentPool(pools);

// Use in dialog
showDialog({
  contentPool: pool,
  buttons: [{
    labelPoolId: 'welcome_confirm',
    label: 'CONTINUE',  // ✅ Required fallback
    role: 'primary'
  }]
});

// Or any button
btn.textContent = pool.select('render_button', {
  fallback: 'RENDER'  // ✅ Always provide fallback
});
```

## Adding New Pools

1. Create JSON file: `yourComponent.json`
2. Add pools with descriptive IDs
3. Register in `poolLoader.js`
4. Use with `labelPoolId` + mandatory `label` fallback

## Defensive Programming

**CRITICAL:** Every button MUST have a hardcoded `label` fallback:

```json
// ✅ GOOD
{
  "labelPoolId": "render_button",
  "label": "RENDER"
}

// ❌ BAD - No fallback!
{
  "labelPoolId": "render_button"
}
```

This ensures buttons always display text, even if:
- JSON file fails to load
- Pool ID is typo'd
- Network error occurs
- ContentPool instance is missing
