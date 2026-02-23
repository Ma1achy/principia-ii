# Chazy Content JSON Schema

**Last Updated**: 2026-02-23

This document describes the JSON schema for Chazy's content system, including both ambient and interaction-driven dialogue.

---

## Table of Contents

1. [File Structure](#file-structure)
2. [Schema Definitions](#schema-definitions)
3. [Ambient Content Schema](#ambient-content-schema)
4. [Interaction Content Schema](#interaction-content-schema)
5. [Complete Interaction List](#complete-interaction-list)
6. [Line Object Formats](#line-object-formats)
7. [Template References](#template-references)
8. [Examples](#examples)

---

## File Structure

```
src/Chazy/lines/
├── core/                        # Ambient content (non-event-driven)
│   ├── boundary.json
│   ├── mathematical.json
│   ├── existential.json
│   ├── infohazard.json
│   ├── dark-humor.json
│   └── observational.json
│
└── interactions/                # Event-driven content
    ├── lifecycle/               # Lifecycle events
    │   ├── welcome.json
    │   └── idle.json
    │
    ├── gui/                     # GUI interaction events
    │   ├── buttons/
    │   │   ├── render/
    │   │   │   ├── click.json
    │   │   │   └── hesitation.json
    │   │   ├── reset/
    │   │   │   ├── click.json
    │   │   │   └── hesitation.json
    │   │   ├── save/
    │   │   │   ├── click.json
    │   │   │   └── hesitation.json
    │   │   ├── copy/
    │   │   │   ├── click.json
    │   │   │   └── hesitation.json
    │   │   ├── share/
    │   │   │   ├── click.json
    │   │   │   └── hesitation.json
    │   │   ├── zero/
    │   │   │   ├── click.json
    │   │   │   └── hesitation.json
    │   │   ├── randomize/
    │   │   │   ├── click.json
    │   │   │   └── hesitation.json
    │   │   ├── reset-tilts/
    │   │   │   ├── click.json
    │   │   │   └── hesitation.json
    │   │   ├── apply-json/
    │   │   │   ├── click.json
    │   │   │   └── hesitation.json
    │   │   └── download-json/
    │   │       ├── click.json
    │   │       └── hesitation.json
    │   │
    │   ├── sliders/
    │   │   ├── generic/
    │   │   │   ├── hover.json
    │   │   │   └── changed.json
    │   │   ├── horizon/
    │   │   │   └── changed.json
    │   │   ├── max-steps/
    │   │   │   └── changed.json
    │   │   ├── dt-macro/
    │   │   │   └── changed.json
    │   │   ├── r-coll/
    │   │   │   └── changed.json
    │   │   └── r-esc/
    │   │       └── changed.json
    │   │
    │   └── selects/
    │       ├── render-mode/
    │       │   ├── hover.json
    │       │   └── changed.json
    │       └── resolution/
    │           ├── hover.json
    │           └── changed.json
    │
    ├── physics/                 # Physics simulation events
    │   ├── collision.json
    │   ├── ejection.json
    │   └── stable.json
    │
    ├── navigation/              # User navigation events
    │   ├── zoom.json
    │   └── drag.json
    │
    ├── rendering/               # Render completion events
    │   └── render.json
    │
    ├── patterns/                # Behavioral pattern detection
    │   ├── slider-exploration.json
    │   └── preset-browsing.json
    │
    └── generic-fallback.json    # Fallback for unmatched events
```

---

## Schema Definitions

### Root File Structure

All content files follow this structure:

```typescript
{
  "_file": string,              // File identifier
  "_description": string,       // Human-readable description
  "_context": {                 // Context matching criteria
    "when"?: string[],          // When to show (visual modes)
    "what"?: string[],          // What is happening (event types)
    "event"?: string,           // Event name (for interactions)
    "button"?: string,          // Button identifier (for button events)
    "slider"?: string,          // Slider identifier (for slider events)
    "select"?: string           // Select identifier (for select events)
  },
  "_notes"?: string,            // Optional implementation notes
  "lines": Entry[]              // Array of dialogue entries
}
```

### Entry Object

Each entry in the `lines` array:

```typescript
{
  "select_bias": {              // Emotional selection weights (0.0-5.0+)
    "neutral"?: number,
    "curious"?: number,
    "analytical"?: number,
    "amused"?: number,
    "concerned"?: number,
    "contemplative"?: number,
    "excited"?: number,
    "bored"?: number,
    "surprised"?: number
  },
  "reflect_pull": {             // Emotional transition weights (same as above)
    [emotion: string]: number   // Influences Chazy's next emotion
  },
  "tone"?: string,              // Delivery tone (see Tones below)
  "themes": string[],           // Content themes (see Themes below)
  "lines": Line[]               // Array of lines to display sequentially
}
```

### Line Object

Lines can be either a **string** or an **object**:

**Simple String:**
```typescript
"Some text to display"
```

**Object Format:**
```typescript
{
  "t": string,                  // Text content
  "rarity"?: number,            // Probability (0.0-1.0) of including this line
  "tone"?: string,              // Override tone for this line
  "duration_mult"?: number      // Display time multiplier (e.g., 1.2 = 20% longer)
}
```

---

## Ambient Content Schema

**Location**: `src/Chazy/lines/core/*.json`

**Purpose**: Non-event-driven musings and observations. Chazy speaks these during idle moments based on her emotional state.

**Context Matching**:
```json
"_context": {
  "when": ["*"],  // Matches any visual mode
  "what": ["*"]   // Matches any situation
}
```

**Ambient Files**:
- `boundary.json` - Lines about boundaries, edges, limits (Chazy's signature theme)
- `mathematical.json` - Mathematical observations and equations
- `existential.json` - Philosophical and existential musings
- `infohazard.json` - Hazardous or memetic content warnings
- `dark-humor.json` - Dark humor and gallows humor
- `observational.json` - General observations about the simulation

**Example**:
```json
{
  "_file": "boundary",
  "_description": "Lines about boundaries, edges, limits - Chazy's signature theme",
  "_context": {
    "when": ["*"],
    "what": ["*"]
  },
  "lines": [
    {
      "select_bias": {
        "amused": 3.0,
        "contemplative": 1.8
      },
      "reflect_pull": {
        "amused": 3.0,
        "contemplative": 1.8
      },
      "themes": ["boundary", "mathematics", "wry"],
      "lines": [
        "A map pretending to be a territory",
        "A territory pretending to be a map"
      ]
    }
  ]
}
```

---

## Interaction Content Schema

**Location**: `src/Chazy/lines/interactions/**/*.json`

**Purpose**: Event-driven responses to user actions, simulation events, and behavioral patterns.

**Context Matching Examples**:

**Button Click:**
```json
"_context": {
  "event": "button_click_render",
  "button": "render"
}
```

**Slider Change:**
```json
"_context": {
  "event": "slider_changed",
  "slider": "horizon"
}
```

**Generic Slider:**
```json
"_context": {
  "event": "slider_changed",
  "slider": "*"  // Matches any slider
}
```

**Physics Event:**
```json
"_context": {
  "event": "collision"
}
```

**Lifecycle Event:**
```json
"_context": {
  "when": ["welcome"],  // Special mode for first load
  "what": ["*"]
}
```

---

## Complete Interaction List

### **Lifecycle Events**

| Event | File | Description |
|-------|------|-------------|
| `welcome` | `lifecycle/welcome.json` | First page load, greeting messages |
| `idle` | `lifecycle/idle.json` | User inactive for extended period |

### **GUI Events - Buttons**

| Event | Button ID | Hesitation File | Click File |
|-------|-----------|----------------|-----------|
| `button_hesitation` | `render` | `buttons/render/hesitation.json` | - |
| `button_click_render` | `render` | - | `buttons/render/click.json` |
| `button_hesitation` | `reset` | `buttons/reset/hesitation.json` | - |
| `button_click_reset` | `reset` | - | `buttons/reset/click.json` |
| `button_hesitation` | `save` | `buttons/save/hesitation.json` | - |
| `button_click_save` | `save` | - | `buttons/save/click.json` |
| `button_hesitation` | `copy` | `buttons/copy/hesitation.json` | - |
| `button_click_copy` | `copy` | - | `buttons/copy/click.json` |
| `button_hesitation` | `share` | `buttons/share/hesitation.json` | - |
| `button_click_share` | `share` | - | `buttons/share/click.json` |
| `button_hesitation` | `zero_z0` | `buttons/zero/hesitation.json` | - |
| `button_click_zero_z0` | `zero_z0` | - | `buttons/zero/click.json` |
| `button_hesitation` | `randomize_z0` | `buttons/randomize/hesitation.json` | - |
| `button_click_randomize_z0` | `randomize_z0` | - | `buttons/randomize/click.json` |
| `button_hesitation` | `reset_tilts` | `buttons/reset-tilts/hesitation.json` | - |
| `button_click_reset_tilts` | `reset_tilts` | - | `buttons/reset-tilts/click.json` |
| `button_hesitation` | `apply_json` | `buttons/apply-json/hesitation.json` | - |
| `button_click_apply_json` | `apply_json` | - | `buttons/apply-json/click.json` |
| `button_hesitation` | `download_json` | `buttons/download-json/hesitation.json` | - |
| `button_click_download_json` | `download_json` | - | `buttons/download-json/click.json` |

### **GUI Events - Sliders**

| Event | Slider ID | Hover File | Changed File |
|-------|-----------|-----------|--------------|
| `slider_hover` | `*` (generic) | `sliders/generic/hover.json` | - |
| `slider_changed` | `*` (generic) | - | `sliders/generic/changed.json` |
| `slider_changed` | `horizon` | - | `sliders/horizon/changed.json` |
| `slider_changed` | `max_steps` | - | `sliders/max-steps/changed.json` |
| `slider_changed` | `dt_macro` | - | `sliders/dt-macro/changed.json` |
| `slider_changed` | `r_coll` | - | `sliders/r-coll/changed.json` |
| `slider_changed` | `r_esc` | - | `sliders/r-esc/changed.json` |

### **GUI Events - Select/Dropdowns**

| Event | Select ID | Hover File | Changed File |
|-------|-----------|-----------|--------------|
| `select_hover` | `render_mode` | `selects/render-mode/hover.json` | - |
| `select_changed` | `render_mode` | - | `selects/render-mode/changed.json` |
| `select_hover` | `resolution` | `selects/resolution/hover.json` | - |
| `select_changed` | `resolution` | - | `selects/resolution/changed.json` |

### **Physics Events**

| Event | File | Description |
|-------|------|-------------|
| `collision` | `physics/collision.json` | Two bodies collided |
| `ejection` | `physics/ejection.json` | Body ejected from system |
| `stable` | `physics/stable.json` | System reached stable orbit |

### **Navigation Events**

| Event | File | Description |
|-------|------|-------------|
| `zoom` | `navigation/zoom.json` | User zoomed in/out |
| `drag` | `navigation/drag.json` | User dragged the view |

### **Rendering Events**

| Event | File | Description |
|-------|------|-------------|
| `render_completed` | `rendering/render.json` | Render completed successfully |
| `render_started` | `rendering/render.json` | Render started (observational) |
| `render_aborted` | `rendering/render.json` | Render was aborted |

### **Pattern Detection Events**

| Event | File | Description |
|-------|------|-------------|
| `slider_exploration` | `patterns/slider-exploration.json` | User exploring multiple sliders rapidly |
| `preset_browsing` | `patterns/preset-browsing.json` | User trying different presets |

### **Fallback**

| Event | File | Description |
|-------|------|-------------|
| `*` | `generic-fallback.json` | Catches any unmatched events |

---

## Line Object Formats

### **Multi-Line Entries**

Lines are displayed **sequentially** with pauses between them:

```json
{
  "lines": [
    "First line displays",
    "Then this appears after a pause",
    "Finally this line"
  ]
}
```

### **Conditional Lines with Rarity**

Use rarity to show lines probabilistically:

```json
{
  "lines": [
    "Always shows",
    {
      "t": "Shows 80% of the time",
      "rarity": 0.8
    },
    {
      "t": "Shows 20% of the time",
      "rarity": 0.2
    }
  ]
}
```

### **Tone Override**

Override the entry's default tone for specific lines:

```json
{
  "tone": "neutral",
  "lines": [
    "Normal tone line",
    {
      "t": "This one is whispered",
      "rarity": 0.7,
      "tone": "whisper"
    }
  ]
}
```

### **Duration Multiplier**

Make specific lines stay on screen longer:

```json
{
  "lines": [
    "Normal duration",
    {
      "t": "This stays 20% longer for dramatic effect",
      "rarity": 1.0,
      "duration_mult": 1.2
    }
  ]
}
```

---

## Template References

Content can include **dynamic state references** using the `\ref{}` syntax:

### **Syntax**
```
\ref{key}            # Simple reference
\ref{key|formatter}  # Reference with formatter
```

### **Available References**

**Render Settings:**
- `resolution` - Current resolution (e.g., "1024×1024")
- `resolution_int` - Resolution as number
- `render_mode` - Render mode name
- `render_mode_num` - Render mode index

**Slice Coordinates:**
- `z0`, `z1`, `z2`, ..., `z9` - Individual coordinate values (formatted)
- `z0_name`, `z1_name`, ..., `z9_name` - Axis names (e.g., "z₀")
- `z_coords` - All coordinates as comma-separated list

**Simulation Parameters:**
- `horizon` - Horizon value
- `horizon_int` - Horizon as integer
- `max_steps` - Max steps with locale formatting
- `max_steps_k` - Max steps in thousands (e.g., "100k")
- `dt_macro` - Time step
- `r_coll` - Collision radius
- `r_esc` - Escape radius

**Orientation:**
- `tilt_dim1`, `tilt_dim2` - Tilt dimensions
- `tilt_q1`, `tilt_q2` - Tilt amounts

**Computed/Conditional:**
- `is_high_res` - Boolean: true if resolution > 1024
- `res_quality` - String: "ultra" (>2048), "high" (>1024), or "low"
- `total_dims` - Total number of dimensions (usually 10)

**Event-Specific (from eventData):**
- `new_value` - New value after change
- `old_value` - Previous value before change
- `delta` - Amount of change
- `slider_name` - Slider that was changed
- `select_name` - Select that was changed
- `button_name` - Button that was clicked

### **Formatters**

- `int` - Round to integer
- `fixed1`, `fixed2`, `fixed3`, `fixed4` - Fixed decimal places
- `sci` - Scientific notation (e.g., 1.23e-4)
- `percent` - Multiply by 100 and add % (e.g., "45%")
- `upper` - Uppercase
- `lower` - Lowercase

### **Examples**

```json
{
  "lines": [
    "Resolution set to \\ref{resolution}",
    "Horizon: \\ref{horizon|fixed2}",
    "You changed \\ref{slider_name} to \\ref{new_value|fixed1}",
    "Rendering in \\ref{res_quality} quality mode",
    "Total dimensions: \\ref{total_dims}"
  ]
}
```

**Output:**
```
Resolution set to 2048×2048
Horizon: 25.50
You changed max_steps to 100000.0
Rendering in high quality mode
Total dimensions: 10
```

---

## Mid-Line Pauses

Pause typing mid-line for dramatic effect using `\pause{ms}`:

### **Syntax**

```
\pause{milliseconds}
```

The pause occurs **after** typing the text that precedes it, before continuing with the text that follows.

### **Duration Range**

- **Minimum**: 50ms (automatically clamped)
- **Maximum**: 5000ms (automatically clamped)
- **Recommended**: 300-1500ms for most use cases

### **Examples**

```json
{
  "lines": [
    "Wait\\pause{800}... did you see that?",
    "I understand\\pause{1200}.",
    "Oh\\pause{600}. Oh no.",
    "Calculating\\pause{1500}... done"
  ]
}
```

### **Use Cases**

**Dramatic Reveals:**
```json
"I see\\pause{800}... I see everything"
```

**Comedic Timing:**
```json
"Sure, that's\\pause{1000}... fine"
```

**Thinking/Processing:**
```json
"Hold on\\pause{900}... that's not right"
```

**Emotional Weight:**
```json
"I understand\\pause{700}."
```

### **Multiple Pauses in One Line**

```json
{
  "lines": [
    "One\\pause{300} two\\pause{400} three"
  ]
}
```

Text stays visible throughout all pauses (unlike multi-line with `stage_pause` where earlier text deletes).

### **With State References**

Pauses work seamlessly with `\ref{}`:

```json
{
  "lines": [
    "Mode: \\ref{render_mode}\\pause{600}... interesting choice"
  ]
}
```

**Processing Order**: `\ref{}` is replaced first (in TextSelector), then `\pause{}` is processed during animation.

### **Edge Cases**

**Start of line:**
```json
"\\pause{500}Hello"  // Pauses before typing begins
```

**End of line:**
```json
"Hello\\pause{500}"  // Pauses after typing completes, before cursor blinks
```

**Escaped pause (literal text):**
```json
"Use \\\\pause{500} for pauses"  // Shows "\pause{500}" as text, no pause occurs
```

### **Behavior**

- ✅ **Interruptible**: Pauses can be interrupted by user actions (hover, click). This creates natural "thinking moments" where Chazy notices events.
- ✅ **Typo-safe**: If a typo occurs before a pause, the correction completes before the pause executes.
- ✅ **Scramble-aware**: Character scramble animations complete before pauses.
- ⚠️ **Validation**: Invalid durations (zero, negative, non-numeric) are clamped to minimum (50ms) with console warnings.
- ⚠️ **Consecutive pauses**: Multiple pauses with no text between them are automatically merged with a warning.

### **Notes**

- Pauses are for **mid-line** dramatic timing
- For **multi-line** pauses (where text deletes between lines), use `stage_pause` in the entry config
- Automatic typing pauses (punctuation, word boundaries) still occur normally
- Pauses represent "thinking moments" — perfect for natural interruption points

---

## Tones

Available delivery tones (affects typing speed and style):

- `neutral` - Default, balanced delivery
- `whisper` - Slower, deliberate, quiet
- `ominous` - Measured, foreboding
- `wry` - Slightly quicker, dry wit
- `deadpan` - Crisp, flat, efficient
- `clinical` - Efficient, precise, technical
- `warm` - Gentle, unhurried, friendly
- `concerned` - Variable pace, anxious
- `surprised` - Reactive, quick

---

## Themes

Common themes for categorization:

**Core Concepts:**
- `boundary` - Edges, limits, basin boundaries
- `mathematics` - Math concepts, equations
- `chaos` - Chaotic behavior, sensitivity
- `pattern` - Patterns, structures
- `physics` - Physical concepts

**Emotional/Stylistic:**
- `existential` - Philosophical, deep
- `dark` - Dark humor, ominous
- `poetic` - Lyrical, artistic
- `wry` - Dry humor, ironic
- `joke` - Lighthearted humor
- `terse` - Brief, minimal

**Technical:**
- `classified` - SCP-style technical documentation
- `hazard` - Warnings, dangers
- `technical` - Technical jargon
- `infohazard` - Memetic hazards

**Situational:**
- `waiting` - Idle, patience
- `discovery` - Finding, exploring
- `inspection` - Looking closely, zooming
- `control` - Agency, influence
- `escape` - Ejection, leaving

---

## Examples

### **Example 1: Simple Ambient Entry**
```json
{
  "select_bias": {
    "contemplative": 2.0,
    "curious": 1.8
  },
  "reflect_pull": {
    "contemplative": 2.0,
    "curious": 1.8
  },
  "themes": ["boundary", "chaos"],
  "lines": [
    "The edge produces more edge"
  ]
}
```

### **Example 2: Multi-Line Welcome with Rarity**
```json
{
  "select_bias": {
    "contemplative": 3.0,
    "curious": 2.3,
    "excited": 1.8
  },
  "reflect_pull": {
    "contemplative": 2.5,
    "curious": 1.5
  },
  "tone": "whisper",
  "themes": ["boundary", "existential", "waiting"],
  "lines": [
    "You are standing at the edge",
    {
      "t": "The edge has been waiting",
      "rarity": 0.7
    },
    {
      "t": "It remembers everyone who stood here",
      "rarity": 0.3,
      "tone": "ominous"
    }
  ]
}
```

### **Example 3: Button Click with Template**
```json
{
  "select_bias": {
    "excited": 2.0,
    "curious": 1.6
  },
  "tone": "warm",
  "themes": ["creation", "anticipation"],
  "lines": [
    "Oh!",
    "Rendering at \\ref{resolution}",
    "This might take a moment"
  ]
}
```

### **Example 4: Slider Change with Delta**
```json
{
  "select_bias": {
    "analytical": 2.0,
    "curious": 1.5
  },
  "tone": "clinical",
  "themes": ["mathematics", "technical"],
  "lines": [
    "\\ref{slider_name} adjusted",
    {
      "t": "New value: \\ref{new_value|fixed2}",
      "rarity": 0.8
    },
    {
      "t": "Delta: \\ref{delta|fixed2}",
      "rarity": 0.4
    }
  ]
}
```

---

## Validation Checklist

When creating new content files:

- [ ] `_file` is set and descriptive
- [ ] `_description` explains the content
- [ ] `_context` matches the correct event/situation
- [ ] All entries have `select_bias` (at least 1 emotion)
- [ ] All entries have `reflect_pull` (guides emotional transitions)
- [ ] `themes` array has at least 1 theme
- [ ] `lines` array has at least 1 line
- [ ] Template references use correct syntax `\ref{key}`
- [ ] Tone names match available tones
- [ ] Rarity values are between 0.0 and 1.0
- [ ] JSON is valid (no syntax errors)

---

## Notes

- **Emotional Weights**: Higher values (2.0-3.5) mean more likely to select in that emotion. Use 1.0 as baseline.
- **Reflect Pull**: Influences Chazy's next emotional state. Strong pulls (2.5+) guide transitions.
- **Wildcards**: Use `"*"` in context fields to match anything
- **Sequential Display**: Lines in an entry play one after another with automatic pauses
- **Rarity Stacking**: Rare lines can stack - a 0.7 rare line inside a 0.8 rare line = 56% chance
- **Template Escaping**: Use `\\ref{}` in JSON strings (backslash must be escaped)

---

**End of Schema Documentation**
