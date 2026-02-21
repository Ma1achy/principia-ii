# Chazy Lines JSON Schema - Version 3

## Quick Reference

```json
{
  "_context": {
    "when": ["*"],  // or ["any"] - both work
    "what": ["collision", "zoom"]
  },
  "lines": [
    {
      "select_bias": { "bored": 3.5, "contemplative": 2.0 },
      "reflect_pull": { "contemplative": 2.5, "curious": 1.3 },
      "tone": "whisper",
      "themes": ["existential", "poetic"],
      "lines": [
        "Simple string line",
        { 
          "t": "Line with overrides", 
          "rarity": 0.6,
          "tone": "deadpan",
          "duration_mult": 1.3
        }
      ]
    }
  ]
}
```

## Field Reference

### File-Level Fields

#### `_context` (object, optional)
Provides default context for all entries in file.

**Properties**:
- `when` (array of strings): Event contexts (collision, zoom, idle, etc.)
- `what` (array of strings): Action contexts (same as when, legacy support)

**Wildcards**: Use `"*"` or `"any"` to match all contexts

**Example**:
```json
"_context": {
  "when": ["*"],
  "what": ["collision", "zoom"]
}
```

---

### Entry-Level Fields

#### `select_bias` (object, optional)
Controls text selection probability based on current emotion.

**Type**: `{ [emotion: string]: number }`

**Default**: `{}` (neutral, weight 1.0 for all emotions)

**Example**: 
```json
"select_bias": { 
  "bored": 3.5,      // 3.5x more likely when bored
  "curious": 1.2,    // 1.2x more likely when curious
  "excited": 0.5     // 0.5x less likely when excited
}
```

**Behavior**: 
- Higher values = more likely to be selected
- Modulated by intensity: `effectiveWeight = 1.0 + (rawWeight - 1.0) * intensity`

---

#### `reflect_pull` (object, optional)
Influences Chazy's emotional state after displaying this text.

**Type**: `{ [emotion: string]: number }`

**Default**: `{}` (no influence on transitions)

**Example**:
```json
"reflect_pull": {
  "contemplative": 1.8,  // Pulls strongly toward contemplation
  "analytical": 1.3,     // Moderate pull toward analysis
  "bored": 0.5           // Reduces boredom tendency
}
```

**Behavior**:
- Modulates edge weights in emotion graph traversal
- Creates bidirectional feedback loop

**Use Case**:
```json
// Bored observation that makes you thoughtful
{
  "select_bias": { "bored": 3.5 },        // Say when bored
  "reflect_pull": { "contemplative": 2.0 }, // But push toward contemplation
  "lines": ["Waiting reveals structure"]
}
```

---

#### `tone` (string, optional)
Modifies typing animation delivery style.

**Type**: `"whisper" | "clinical" | "wry" | "ominous" | "warm" | "deadpan" | "neutral"`

**Default**: `"neutral"`

**Values**:

| Tone | Speed | Typos | Pauses | Use Case |
|------|-------|-------|--------|----------|
| `whisper` | Slower (1.2x) | Fewer (0.5x) | Longer (1.3x) | Philosophical, secretive |
| `clinical` | Precise (0.95x) | Minimal (0.3x) | Normal | Technical, factual |
| `wry` | Quick (0.9x) | Normal (1.1x) | Short (0.9x) | Jokes, sarcasm |
| `ominous` | Slow (1.5x) | Deliberate (0.2x) | Long (2.0x) | Warnings, darkness |
| `warm` | Comfortable (1.05x) | Relaxed (0.9x) | Natural (1.1x) | Friendly, inviting |
| `deadpan` | Metronomic (1.0x) | Rare (0.1x) | Consistent | Flat delivery, monotone |
| `neutral` | Baseline (1.0x) | Baseline (1.0x) | Baseline (1.0x) | Default |

**Example**:
```json
{
  "select_bias": { "amused": 2.8 },
  "tone": "wry",
  "lines": ["At least the math is having fun"]
}
```

---

#### `themes` (array of strings, optional)
Thematic tags for text selection matching.

**Example**:
```json
"themes": ["existential", "poetic", "dark"]
```

**Common Themes**:
- `boundary`, `chaos`, `mathematics`, `existential`
- `joke`, `wry`, `dark`, `poetic`
- `hazard`, `classified`, `discovery`

---

#### `lines` (array of string | object, required)
Text content with optional per-line overrides.

**String format**: Simple text line (most common)

**Object format**: Text with modifiers

**Example**:
```json
"lines": [
  "Simple string line",
  { 
    "t": "Line with overrides", 
    "rarity": 0.6,
    "tone": "whisper",
    "duration_mult": 1.3
  }
]
```

---

### Line-Level Fields (Object Format)

#### `t` (string, required in object)
The text content.

---

#### `rarity` (number, optional, 0.0-1.0)
Probability this variant is shown when entry selected.

**Default**: `1.0` (always shown)

**Example**: `0.6` = 60% chance

**Behavior**: 
- If roll fails, line is skipped (multiline) or entry is skipped (single line)
- Use >= 0.5 for lines that should appear most of the time

---

#### `tone` (string, optional)
Overrides entry-level tone for this specific line.

**Same values as entry-level `tone`**

---

#### `duration_mult` (number, optional)
Multiplier for display duration.

**Default**: `1.0`

**Example**: `1.5` = display 50% longer than normal

---

## Complete Examples

### Example 1: Cross-Emotion Pull

```json
{
  "select_bias": { "bored": 3.5, "idle": 2.0 },
  "reflect_pull": { "contemplative": 2.5, "curious": 1.3 },
  "tone": "whisper",
  "themes": ["waiting", "existential"],
  "lines": [
    "Stillness is data",
    "What you don't do shapes the outcome"
  ]
}
```

### Example 2: Wry Joke

```json
{
  "select_bias": { "amused": 3.0, "bored": 1.5 },
  "reflect_pull": { "amused": 1.8, "curious": 1.2 },
  "tone": "wry",
  "themes": ["joke", "dark", "mathematics"],
  "lines": ["At least the math is having fun"]
}
```

### Example 3: Ominous Warning with Rare Variant

```json
{
  "select_bias": { "concerned": 2.8 },
  "reflect_pull": { "concerned": 2.0, "contemplative": 1.5 },
  "tone": "ominous",
  "themes": ["classified", "hazard"],
  "lines": [
    "Boundary conditions are mandatory",
    { 
      "t": "Ignore at your peril", 
      "rarity": 0.4,
      "tone": "deadpan"
    }
  ]
}
```

### Example 4: Deadpan Observation

```json
{
  "select_bias": { "analytical": 2.5, "contemplative": 1.8 },
  "reflect_pull": { "analytical": 1.5 },
  "tone": "deadpan",
  "themes": ["terse", "mathematics"],
  "lines": ["Three bodies. Indefinite outcomes."]
}
```

## Backwards Compatibility

### Old Schema (v2)
```json
{
  "weights": { "bored": 3.5, "contemplative": 2.0 },
  "themes": ["dark", "wry"],
  "lines": ["Line 1", "Line 2"]
}
```

### New Schema (v3)
```json
{
  "select_bias": { "bored": 3.5, "contemplative": 2.0 },
  "reflect_pull": { "bored": 1.2, "contemplative": 1.8 },
  "tone": "whisper",
  "themes": ["dark", "wry"],
  "lines": [
    "Line 1",
    { 
      "t": "Line 2 variant", 
      "rarity": 0.6,
      "tone": "deadpan"
    }
  ]
}
```

**All old schema files work without changes** - new fields are optional with sensible defaults.

## Validation Rules

1. **Required Fields**:
   - `lines` array must exist and have at least one element
   - Object-format lines must have `t` property

2. **Optional Fields**:
   - All other fields have defaults
   - Missing fields fall back to backwards-compatible values

3. **Valid Emotions**:
   - `bored`, `excited`, `surprised`, `analytical`
   - `contemplative`, `concerned`, `amused`, `curious`, `neutral`

4. **Valid Tones**:
   - `whisper`, `clinical`, `wry`, `ominous`
   - `warm`, `deadpan`, `neutral`

5. **Valid Contexts**:
   - `welcome`, `collision`, `ejection`, `stable`
   - `zoom`, `drag`, `render`, `idle`
   - `*` or `any` for wildcard

## Migration Checklist

- [ ] Backup JSON files
- [ ] Run migration script in dry-run mode
- [ ] Review proposed changes
- [ ] Run actual migration
- [ ] Test loading and selection
- [ ] Manually tune select_bias vs reflect_pull where desired
- [ ] Add tone tags to themed groups
- [ ] Test emotional transitions
- [ ] Commit changes

---

**Schema Version**: 3  
**Date**: 2026-02-21  
**Status**: Production Ready
