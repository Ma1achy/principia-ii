# Principia

A browser-based WebGPU instrument for exploring the planar three-body problem's
8-dimensional initial-condition (IC) manifold: a real-time visualiser that treats
the IC manifold as a zoomable map and allocates simulation budget where the
dynamics are complex.

## Status

Built milestone by milestone (see [`milestones/`](milestones/)). The canonical
references are `research/spec/principia_spec_revised.tex` (implementation spec),
the ADRs in [`docs/adr/`](docs/adr/), and the per-milestone build docs.

`main` holds the historical proof-of-concept and is **never touched**; the active
integration branch is `webgpu-rewrite`.

## Requirements

- Node.js ≥ 20
- A WebGPU-capable browser (for the GPU milestones; the CPU foundation runs
  headless under Node)

## Commands

```bash
npm install
npm test                       # full Vitest suite (watch mode)
npm test -- --run              # single run
npm test -- --run test/unit/math   # a single suite
npm run typecheck              # tsc --noEmit
npm run lint                   # eslint over src and test
npm run build                  # tsc -p tsconfig.json
```

## Layout

```
src/
  math/        # scalar, vector, softmax, rotation primitives (M0)
test/
  unit/        # fast, dependency-free unit tests
```

Later milestones add `src/integrate/`, `src/decode/`, `src/gpu/`, and the
render/UI layers. Each milestone is done when its acceptance command runs green
with the stated test count.

## Conventions

- **ESM throughout** (`"type": "module"`); imports use explicit `.js` extensions
  even for `.ts` sources.
- **Path alias** `@/*` → `src/*` (set in `tsconfig.json` and `vitest.config.ts`).
- **Strict TypeScript** (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `isolatedModules`, …), targeting ES2022.
