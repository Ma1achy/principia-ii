# Principia

Browser-based WebGPU instrument for exploring the planar three-body problem's
initial-condition manifold: a real-time visualiser that treats the IC manifold
as a zoomable map and allocates simulation budget where the dynamics are complex.
Canonical references: `principia_spec.tex` (implementation spec) and
`principia_milestones.tex` (the milestone-by-milestone build plan). Both are
living documents.

## Branch policy — `main` is untouchable

`main` holds the historical proof-of-concept and is **never touched**. The
active integration branch is `webgpu-rewrite`, and it is the target of every
PR/MR.

- **Never** commit to, push to, merge into, force-push, or open a PR against
  `main`, and don't `checkout`/`switch` to `main` to do work there.
- **Integration branch:** `webgpu-rewrite`. Every PR/MR merges *into*
  `webgpu-rewrite`, never into `main`.
- **Feature flow:** branch off `webgpu-rewrite` (`feat/<thing>`, `fix/<thing>`,
  …), do the work on that feature branch, then merge it back into
  `webgpu-rewrite`. One feature = one feature branch = one PR into
  `webgpu-rewrite`.
- This binds subagents and workflows too: any orchestrated work creates its own
  feature branch off `webgpu-rewrite` and targets `webgpu-rewrite`.

## Stack

TypeScript (strict, ESM) + WebGPU/WGSL compute and render shaders. Vitest for
tests. No framework; the target is the browser.

## Commands

```bash
npm test                       # full Vitest suite
npm test -- --run test/unit/x  # a single suite (note the passthrough `--`)
npm run typecheck              # tsc --noEmit
npm run lint                   # eslint over src and test
npm run build                  # tsc -p tsconfig.json
```

A milestone is done when its acceptance command runs green with the stated test
count — not when the code "looks right."

## How we build: milestones

Work proceeds milestone by milestone (M0 foundations, M1 CPU integrator, M2
decoder atlas, M3 flat-grid GPU, ...). Each milestone has a fixed shape: Goal +
exit command, file tree, per-file implementation **in dependency order**, tests,
"Run it", acceptance check, implementer notes. Build the files in the listed
order, read the implementer notes, and re-run the acceptance command before
calling it done. Details: the `principia-milestone-workflow` skill.

## Conventions

- **ESM throughout** (`"type": "module"`). Imports use explicit `.js` extensions
  even for `.ts` sources: `import { run } from '@/integrate/run.js'`.
- **Path alias** `@/*` -> `src/*` (set in `tsconfig.json` and
  `vitest.config.ts`).
- **Barrel exports**: each module exposes its surface via `index.ts`.
- **Strict TS**: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`, `isolatedModules`. Target ES2022.

## Non-negotiables

These fail **silently** — no crash, no type error, just wrong numbers or
corrupted pixels — so keep them in mind every session even before a skill fires.
Each points to the skill that carries the detail.

- **GPU struct layout is one artifact.** Any struct shared between TS and WGSL
  must change in three places in the same commit: the WGSL struct, the
  `structs.ts` packer, and the alignment pin test. -> `principia-gpu`
- **Symplectic integration only**, and call `projectCOM` after **every** macro
  step. Yoshida's negative middle weights are correct, not a bug. ->
  `principia-numerics`
- **The decode pipeline is total**: tag failures (`DEGENERATE(reason)`,
  `COLLISION_T0`), never throw. Every pixel gets a label. ->
  `principia-numerics`, `principia-architecture`
- **Only `TileReduction` crosses GPU->CPU**, and only in Layer 2. Per-sample
  data stays on the GPU. -> `principia-architecture`, `principia-gpu`
- **A new view is a new `(Y, Phi)` chart only.** The decoder, canonicaliser,
  simulation, and rendering are shared; the shader stays chart-agnostic. ->
  `principia-architecture`
- **Float assertions use explicit tolerances**; golden fixtures are generated
  once by a high-precision run, then pinned. -> `principia-testing`

## Skills

Detailed conventions are codified as skills in `.claude/skills/`, consulted
automatically when a task matches:

- **principia-gpu** — WebGPU/WGSL: TS<->WGSL struct layout and alignment,
  f32-only + tile-local precision, workgroups, bind groups, the `principia_`
  namespace, the GPU<->CPU boundary.
- **principia-numerics** — symplectic integrators, COM projection, adaptive
  substepping, event detection with escape persistence, totality, invariant
  (energy / Lz) drift thresholds.
- **principia-testing** — Vitest layout and invocation, float tolerances,
  golden/reference fixtures, struct-alignment pin tests, acceptance checks, CI.
- **principia-milestone-workflow** — the milestone shape and build order, the M0
  conventions, living-document discipline.
- **principia-architecture** — the chart contract, chart-agnostic shader, the
  three-layer tile/quadtree architecture and its data-flow boundaries, the
  two-stage diagnostics/render pipeline.
