# Content Pools

Organized content pools for UI randomization.

## Directory Structure

```
pools/
├── labels/           # Button label pools
│   ├── welcomeBtn.json
│   ├── resolutionWarning.json  (future)
│   ├── controlPanel.json       (future)
│   └── README.md
├── tooltips/         # Tooltip content pools (future)
│   ├── example.json
│   └── README.md
└── README.md         # This file
```

## Organization Principle

Content is organized by **type** (labels vs tooltips) and then by **component**:

- **Labels** (`pools/labels/`) - Button text randomization
- **Tooltips** (`pools/tooltips/`) - Tooltip text randomization (future)

Each JSON file represents one UI component and contains all pools for that component's buttons.

## Quick Start

See subdirectory READMEs:
- `labels/README.md` - Button label system documentation
- `tooltips/README.md` - Tooltip system documentation (future)
