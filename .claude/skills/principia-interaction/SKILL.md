---
name: principia-interaction
description: Interaction conventions for Principia (M8+) — ViewState as the single source of truth, gestures as pure transforms, tilt replace-not-accumulate with Gram–Schmidt, the affine lock and lock-preservation policy, lookup inputs, and what actually survives a latent round trip (masses/ratios/angles — NOT absolute positions or scale). Consult when implementing or reviewing anything in src/interact/ or UI code that mutates the view.
---

# Principia interaction conventions

The interaction layer lands in M8 (`src/interact/`), stays headless until
G12's shell, and is extended by M10 (per-chart lock/preserve overrides) and
M12 (ViewState serialisation). Its failure modes are subtle state drift —
a gesture that works but leaves the view unreproducible.

## ViewState is the single source of truth

Every gesture — slider, zoom, tilt, lock, lookup, palette swap — is a
**pure transform** `(ViewState, input) → ViewState`. No hidden state, no
in-place mutation. The M4 cache key is derived via `viewStateToCacheKey`;
the URL exporter and reproducibility sidecar (M12) serialise ViewState.
Rule: anything that changes what the user sees must be a ViewState field,
and anything that changes tile *contents* must appear in the cache key.
M7's RenderParams knobs are the deliberate exception in kind: they live in
ViewState eventually but must NOT enter the cache key (render-only).

## Tilt: replace, don't accumulate

`q' = cos(τ)·q_base + sin(τ)·ê_k` where `q_base` is the **chart-defined
initial basis** (`unitE8(hAxis)` / `unitE8(vAxis)`), never the currently
tilted vector. Re-issuing τ=30° gives the same q regardless of history —
slider semantics, and what keeps M11's Stage-4 probe deterministic.
Always run `reorthonormalise` (Gram–Schmidt anchored on q1) after any
tilt write; when q2⊥ collapses (both tilts at the same target and angle),
substitute the latent axis least aligned with q1. Assertions on bases:
orthonormal to 1e-12 at every step of a sweep — no normalisation jitter.

## Lock

- `lockAffine` is closed-form: `z = z0 + (2s−1)·mag·q1 + (2t−1)·mag·q2`,
  then decode. Store BOTH the latent z and the decoded physical IC
  (`lockedPhysical`). Locking a terminal pixel keeps `locked: true` with
  `lockedPhysical: undefined` — don't reject the gesture.
- Nonlinear charts (M10) register their own lock via the chart registry;
  M8 handles only the affine case.
- `lockedPhysical` is typed `{...} | undefined` with the `| undefined`
  explicit so clearing it stays legal under `exactOptionalPropertyTypes`.
- Lock preservation across chart switches: decode → inverse-encode into
  the new chart → re-decode; refuse if the round-tripped positions move
  by > 1e-3, surface clamping as `projected: true`. M10 charts may
  override the policy (e.g. project onto the (Lz,E) feasibility parabola).

## What survives a latent round trip (assert THIS, not coordinates)

The 8D chart is scale- and frame-gauged: configuration lives on the shape
sphere at hyperradius R̃ = 1, and decode reconstructs in the canonical
COM frame (ρ rotated to +x, mirror rule applied). Therefore
`inverseEncodeLatent → decodeLatent` preserves:

- the mass tuple (exactly, up to softmax round-off),
- inter-body **distance ratios** and angles (triangle shape),
- momenta in the canonical frame,

and does NOT preserve absolute positions, absolute scale, or the input's
orientation/handedness. Tests must assert the invariant facts (ratios,
angles, masses, frame-consistent comparisons where both sides went
through the same pipeline) — never `r[1] ≈ (0.6, 0)` against raw input
coordinates. Same decision family as the M1 golden ruling: don't pin
gauge, assert robust facts.

## Lookup

`lookup()` funnels every input kind (latent / mass / pythag (m,n) /
explicit triple / physical) into a physical IC, inverse-encodes, decodes
to verify, and returns a **locked** view. Pythag convention: masses
(c, b, a)/Σ 0-indexed (heaviest at the right angle), rest start.
Mass-only input uses a balanced equilateral, rest start. Clamping is
surfaced (`clamped`, `reason: 'lookup_clamped'`) — under
`exactOptionalPropertyTypes`, add optional fields by conditional spread,
never `reason: undefined`.

## GUI-spec reconciliation (when the shell lands)

`research/design/principia_gui_spec.pdf` is authoritative for the G12
shell (component inventory, keyboard scope, DAS/ARR key repeat) but
**wrong about the latent dimension: it says 10D (Z0..Z9); the chart is 8D
(Z0..Z7, masses at Z6/Z7)**. M8 exposes exactly 8 sliders. Keyboard
handling is G12's concern — M8 stays headless; don't let key-repeat
logic leak into the gesture transforms.

## Testing

- Unit: tilt algebra, lock affine offsets, lookup conventions, named
  directions, preservation policy — all pure, no GPU.
- Integration: lookup→lock→decode round trip (frame-consistent
  comparisons only) and a 60-step tilt sweep pinned orthonormal at 1e-12.
- Round-trip tolerances: 1e-9 for mid-range affine latent points, loose
  (1e-3 or ratios) once canonicalise/COM/mirror is in the loop.
