# Design references

Author's planning/design documents that predate or accompany the milestones.
They are **references**, not the canonical build plan — the canonical sources
remain `research/spec/principia_spec_revised.tex`, the `docs/adr/` ADRs, and the
`milestones/` docs. Where a design doc and a canonical source disagree, the
canonical source wins; the discrepancy is noted below.

Triage (assessed 2026-07-06):

| Doc | Status | Informs | Notes |
|---|---|---|---|
| [`principia_gui_spec.pdf`](principia_gui_spec.pdf) | 🟢 **Net-new — authoritative UI design** (⚠ 10D→8D error) | G8, G12, G13, M8, M9, M7, M12 | Component inventory, two-layer panel architecture (Layer 1 always-visible mixing desk / Layer 2 contextual panels), scoped keyboard navigation (scope tree + DAS/ARR), interaction flows, per-component specs, and the single-reactive-store state model (store fields map 1:1 to uniform buffers). The UI milestones reference "a UI" generically; **this is the design to reconcile into them when they are hardened/built** (just-in-time — see below). **⚠ Known error: the doc says the latent is 10D (`Z0..Z9`) — it is 8D. See the correction below; use 8D when reconciling.** |
| [`render_quadtree_design.pdf`](render_quadtree_design.pdf) | 🟡 **Confirmatory — mostly already realized** | M3, M4, M5, M7, G1, G17 | The architecture doc behind the render graph + slippy-map quadtree. Matches what's built: canonical `SimResult` payload, composable colour/brightness/combiner nodes in OKLAB, shared shader helper lib, ancestor-fallback tiles, active-tile-quads, deep-zoom precision. **Independently validates two of our decisions:** "debug shaders as first-class infrastructure" (§8 → G17) and hot-reload / live shader editing (§6 → already in G1). Low net-new; keep as architecture provenance. |
| [`com_projection_mini_spec.pdf`](com_projection_mini_spec.pdf) | 🟡 **Supports M1 / numerics; one net-new policy** | M1, `principia-numerics` | Confirms `projectCOM` after every macro step (a CLAUDE.md non-negotiable). **Net-new:** the explicit policy that only COM position/momentum drift is *projected away*, while energy and Lz drift are **monitored/logged, never enforced** (enforcing E=E₀ is one scalar constraint on a many-dof state and is not physically innocent). Folded into M1 + the numerics skill. |
| [`spherical_colour_map_spec.pdf`](spherical_colour_map_spec.pdf) | 🔵 **Redundant with the spec — provenance only** | M7 | The colour science here is **already canonical in the spec** (§21–24, ~lines 1419–1645): same vMF-OKLAB blend, same OKLAB M₁/M₂ matrices, **identical CVD matrices** (deutan/protan/tritan/achrom), pole-hue table, cubehelix, LUT sphere, pipeline order. The doc's only unique content is decorative pattern modes (Voronoi, Truchet, Perlin, spherical harmonics, Turing waves, dot lattice) from a CPU-JS explorer prototype — **out of scope for the scientific WebGPU renderer.** Kept for provenance; do not treat its pattern modes as requirements. |

## ⚠ Correction: the latent is 8D, not 10D

`principia_gui_spec.pdf` repeatedly describes the latent slice offset as **10D**
(`Z0..Z9`, "10D navigation with number keys", masses at `Z8`/`Z9`, `10×value`
inspector, `Z0..Z9` sliders/text-inputs). **This is wrong.** The canonical latent
is **8-dimensional** and every canonical source agrees:

- Spec `§"The 8D latent chart"` (line ~170–173): "The true symmetry-reduced
  manifold is therefore 8-dimensional: **2 configuration $(\alpha,\beta)$ + 4
  momentum + 2 mass**." Repeated throughout (`\mathbb R^8`, `[0,1]^8`, "6
  dimensions orthogonal to the viewing plane").
- M2: `export type LatentZ = Vec8` ("The latent 8D point").
- A repo-wide grep finds **no** `10D` / `Z8` / `Z9` / `z[8]` / `z[9]` in any
  milestone or the spec — the confusion is isolated to this one reference PDF.

Root cause: the GUI doc counts **4 configuration sliders** (`Z0..Z3`) — the
*pre-gauge-fixing* configuration DOF. The canonical decode fixes rotation
(pinning $\tilde\rho$ to $+x$) and scale ($\tilde R=1$), consuming 2 of those 4,
so only **2 configuration DOF ($\alpha,\beta$)** survive.

**When reconciling the GUI spec into G8/G12/G13/M8/M9, use the 8D layout:**
`Z0..Z7` = 2 configuration ($\alpha,\beta$) + 4 momentum ($p_{\rho x}, p_{\rho y},
p_{\lambda x}, p_{\lambda y}$) + 2 mass logits. Masses are **`Z6`/`Z7`, not
`Z8`/`Z9`**. Number-key navigation is **`1`–`8` (Z0–Z7), not `1`–`0`**. Drop the
GUI doc's `Z2`/`Z3` "config param" sliders — they are the gauge-fixed DOF.

## Just-in-time reconciliation obligations

Deferred deliberately (these milestones are 8+ steps out in the build order;
reconciling now would drift before they are built — same discipline as the M10/M11
just-in-time hardening):

- **When hardening/building G8, G12, G13, M8, M9** — reconcile against
  `principia_gui_spec.pdf`: the component inventory, the Layer 1 / Layer 2 panel
  architecture, the keyboard scope tree + DAS/ARR parameters (DAS 200 ms, ARR
  33 ms, step 0.01 / shift 0.001 / ctrl 0.1), the status-bar field format, and
  the interaction flows. Confirm the store-field ↔ uniform-buffer 1:1 mapping
  matches M8's `ViewState`.
- **When building M7** — the render-mode dropdown enumeration and RENDER SETTINGS
  panel in the GUI spec should match M7's `ColourMode`/`RenderParams`. The
  colour-map PDF is provenance only; the spec is canonical.
- **`principia-render` / `principia-interaction` skills** (authored just-in-time
  before M7 / M8) should cite the GUI spec and this triage.
