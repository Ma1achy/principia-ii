# Tooltip Content Pools

**Status:** Reserved for future implementation

This directory will contain tooltip content pools for randomized tooltip text.

## Planned Schema (Not Yet Implemented)

```json
{
  "tooltip_id": {
    "description": "What this tooltip is for",
    "defaultText": "Fallback tooltip text",
    "entries": [
      {
        "text": "Tooltip variant text",
        "weight": 1.0,
        "kind": "formal"
      }
    ]
  }
}
```

## Usage (Future)

```javascript
// When implemented
const tooltip = pool.selectTooltip('render_button', {
  fallback: 'Render the simulation'
});
```

## Note

Tooltip randomization is intentionally deferred. The infrastructure exists, but activation is a future enhancement after button labels are validated.

See `example.json` for a placeholder structure.
