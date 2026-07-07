# Glossary

## Jacobi coordinates
A relative-coordinate system for the three bodies: one vector between an inner
pair and one from that pair's centre of mass to the third body. They remove
the centre-of-mass motion and are the natural variables for decoding an
initial condition.

## Shape sphere
The space of triangle *shapes* (size- and orientation-free), parametrised as a
2-sphere. Collinear configurations lie on the equator; the poles are the two
equilateral orientations. Principia colours a time-averaged shape direction
(the vMF mean of the checkpoint samples).

## Broucke–Hénon / Euler / Lagrange
Named families of periodic / special three-body configurations. **Euler**: the
collinear central configuration. **Lagrange**: the equilateral central
configuration. **Broucke–Hénon (BC)**: classical periodic-orbit families used
as landmarks (the `bc_proximity` brightness mode measures closeness to them).

## Free-group word
A symbolic encoding of how a bounded trajectory braids around the three
two-body collision points, expressed as a word in the free group `F₂` with
fixed equator generators. Validated for equal masses only (ADR 0004);
unequal-mass words carry a `WORD_UNCERTAIN` flag.

## FTLE
Finite-Time Lyapunov Exponent: the exponential rate at which nearby initial
conditions separate over a finite horizon — a sensitivity / chaos measure.
Computed via full phase-space Benettin in the Research tier only (ADR 0003);
a cleared `FTLE_VALID` bit marks "not computed", not "zero sensitivity".

## Diffusion
A measure of how much a trajectory's shape wanders over the checkpoint window
(its spread on the shape sphere). A `-1.0` sentinel marks "missing"; the
`diffusion` brightness mode renders it.

## Coherence score
The per-tile scalar produced in Layer 2 (`reduce.wgsl`) that summarises how
structured a tile is. It drives refinement: incoherent tiles get split and
prioritised; smooth tiles stay coarse and may be kept at their current depth.

## Ensemble spread
The dispersion across a small ensemble of jittered initial conditions per
sample (stratified jitter, G7), computed in a second reduction pass. It
estimates local sensitivity without a full FTLE and is available from the
Balanced tier up.

## Quality tiers
Preview / Balanced / Research — operating profiles chosen from the device's
WebGPU limits (ADR 0003 / G9). They set sampling density (16/32/64 per tile
axis), checkpoint count, ensemble size, and whether FTLE is computed. A
device that misses a gate degrades a tier rather than over-allocating.

## Two-stage pipeline
The separation of the **compute** stage (decode → simulate → reduce, cached
under the tile cache key) from the **render** stage (colour / brightness /
combiner / palette / CVD, a render-only 64-byte group-3 rebind). Render-mode,
palette, and CVD changes never recompute.

## Chart contract
The interface every view implements: `decode(uv, view)`, `validate(uv, view)`,
`inverseEncode(ic, view?)`, plus `ChartFlags` and a `ChartUniforms` packer.
The simulation and rendering are shared; a new view is a new `(Y, Φ)` chart
only.
