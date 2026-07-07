# User guide

## What Principia is

Principia treats the three-body problem's space of *initial conditions* as a
zoomable map. Each pixel is one initial condition; its colour summarises what
that trajectory *does* — bounded, collision, escape, or degenerate — and how
sensitive it is. You pan and zoom like a slippy map, and Principia spends
simulation budget where the dynamics are intricate (deep, structured regions
get refined; smooth regions stay coarse).

## Charts

A **chart** is a 2-D window `(Y, Φ)` onto the 8-dimensional IC manifold:
`Φ(u, v)` decodes a pixel into masses, positions, and momenta. The shader is
chart-agnostic, so every chart shares the same simulation and rendering.

| Chart (`ChartId`) | What its axes are |
|-------------------|-------------------|
| `latent_slice` | An affine 2-D slice of the raw 8D latent IC space (the default). |
| `lz_e` | Angular momentum `L_z` vs energy `E` at a frozen shape configuration. |
| `lz_k` | Angular momentum `L_z` vs kinetic energy `K` at a frozen shape configuration. |
| `shape_sphere` | The orientation-free triangle shape, parametrised on the sphere. |
| `mass_simplex` | The ternary plot of the three mass fractions. |
| `burrau_euclid` | The classical Burrau configuration parametrised by Euclid triples (plus acute-angle×K, mass, and bifurcation variants). |
| mixed-axis | A factory combining one axis from each of two charts. |

Switch charts from the chart browser (control panel); the **lock** (a pinned
point) is preserved across a switch where the charts share that point — each
chart implements a closed-form `inverseEncode` for exactly this.

## Controls

- **Pan** — drag the canvas.
- **Zoom** — scroll (centred on the cursor), or the `=` / `-` keys. Zoom is a
  *viewport* change: the tile cache is preserved and refined, never thrown
  away.
- **Slice magnification** — the ± buttons change `mag`, which *recomputes*
  (it changes what the pixels mean, not just what you see).
- **Lock** — click to pin a point (`l` toggles); the inspector integrates that
  trajectory at high precision and shows the validation panel (energy / `L_z`
  drift, integrator match, shadow FTLE).
- **Sliders** — the control panel exposes the slice origin `z0..z7`, the tilt,
  and per-chart parameters, plus the render controls.
- **Presets / lookup** — `p` opens the preset gallery; the lookup dialog jumps
  to a typed IC.

## Keyboard shortcuts

Compute-affecting actions use plain keys; window/edit actions use modifiers.
Bindings are rebindable (the G12 keymap).

| Keys | Action |
|------|--------|
| `=` | Zoom in |
| `-` | Zoom out |
| `l` | Toggle lock |
| `Escape` | Dismiss the active overlay, else unlock |
| `Enter` | Confirm the active overlay / lookup |
| `Ctrl+Z` | Undo a view edit |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `p` | Open presets |
| `Shift+?` | Show help |
| `↑` / `↓` | Previous / next slider in the focused panel (roving focus) |
| `Alt+C` / `Alt+Shift+C` | Cycle colour-vision simulation (forward / reverse) |
| `Alt+H` | Toggle high-contrast theme |
| `Alt+=` / `Alt+-` | Increase / decrease font size |
| `~` (Shift+backtick) | Toggle the developer HUD (perf, errors, tile flags) |

Undo/redo cover only view edits that change *what is computed*; render-only
changes (palette, colour mode, colour-vision mode) are not in the history.

## Render modes

Rendering composes three independent choices — a **colour mode** (which
diagnostic drives the hue), a **brightness mode** (which diagnostic modulates
lightness), and a **combiner** — plus a palette. Every one of them is
**render-only**: switching rebinds a single 64-byte parameter buffer and never
recomputes a trajectory (see the two-stage pipeline in
[Architecture](architecture.md)).

The colour modes group as:

| Group | Modes | Shows |
|-------|-------|-------|
| Outcome | `event_class` (default) | The terminal class per pixel: bounded / collision / escape / degenerate. |
| Invariants | `energy`, `ang_momentum`, `kinetic`, `potential`, `virial` | The conserved (or diagnostic) quantities of the decoded IC. |
| Masses | `mass_ratio_12`, `mass_ratio_13`, `mass_fraction` | The mass structure across the chart. |
| Geometry | `jacobi_rho1`, `jacobi_rho2`, `jacobi_ratio`, `jacobi_angle`, `min_pair_dist` | The Jacobi-coordinate geometry of the IC. |
| Events | `escape_time`, `close_encounters`, `min_approach` | When/how the defining event happened. |
| Numerics | `energy_drift_abs/rel`, `lz_drift_abs/rel` | Integration-quality diagnostics (suspect pixels). |
| Shape | `shape_sphere_vmf`, `shape_sphere_okabe_ito` | The time-averaged shape direction, coloured on the sphere. |
| Stability | `stability_x_hue` | Hue from position, lightness from a stability proxy. |

Brightness modes: `flat`, `time_to_event`, `diffusion` (shape wander),
`bc_proximity` (closeness to the Broucke–Hénon landmarks), `energy_drift`.

## Colour-vision (CVD) modes

`Alt+C` cycles a colour-vision-deficiency *simulation* applied in
post-processing (`none` → `protan` → `deutan` → `tritan` → `achrom`). It is a
render-only toggle: it shows what a CVD viewer sees and never changes the data
or the cache.

## Quality tiers

Principia auto-selects a **quality tier** from your GPU's capabilities
(see [ADR 0003](adr-index.md)):

- **Preview** — 16×16 samples per tile, no ensembles, no FTLE.
- **Balanced** — 32×32 samples per tile, ensembles up to 4, no FTLE.
- **Research** — 64×64 samples per tile, ensembles up to 16, FTLE enabled,
  16 checkpoints requested (the current GPU result struct carries 8 lanes).

A weaker device degrades a tier rather than risk an over-allocation; a warning
is shown when it does.
