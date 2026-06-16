---
name: principia-milestone-workflow
description: >-
  How to execute a Principia milestone end to end. Covers the fixed milestone
  shape (Goal and exit criterion, file tree, per-file implementation in order,
  tests, "Run it" command, acceptance check, implementer notes), the top-down
  build order, the project conventions inherited from M0 (ESM, strict TypeScript,
  the @/ path alias, barrel index.ts exports), and the living-document
  discipline that keeps contracts stable across milestones. Use this skill
  whenever starting a new milestone (M0, M1, M2, ...), implementing files within
  one, scaffolding a new module, or deciding whether a milestone is actually
  done. Apply it even when a change feels small: building files out of order or
  skipping the acceptance command leaves broken intermediate states that the next
  milestone is not designed to absorb.
---

# Principia milestone workflow

Principia is built as an ordered sequence of milestones — M0 foundations, M1 CPU
reference integrator, M2 decoder atlas, M3 flat-grid GPU, and onward — and
`principia_milestones.tex` is the build plan. Each milestone is written in the
same shape on purpose, and the shape is the operating rhythm of the project.
Follow it rather than improvising an order.

## The milestone shape

Every milestone has these sections, in this order:

1. **Goal** — one paragraph plus a single **exit criterion**: an exact command
   that must pass (e.g. `npm test -- --run test/unit/math` with 30+ green tests).
2. **Deliverable** — one line stating what concretely works when the milestone
   lands and what the user can see or run (open a page, run an export), or an
   explicit "internal — tests only (no visible artifact yet)". GPU/UI milestones
   should ship a dev-harness page as their deliverable.
3. **File tree** — the exact set of files this milestone creates. This is the
   scope; don't add files from later milestones.
4. **Per-file sections** — the source for each file, in dependency order.
5. **Tests** — the unit and golden tests for the milestone.
6. **Run it** — the exact `npm` command(s) to execute.
7. **Acceptance check** — the binary done condition.
8. **Notes for the implementer** — the gotchas. Read these; they carry the
   non-obvious decisions.

## Build top-down, in the listed order

Implement the files in the order the milestone lists them. The ordering is not
arbitrary: dependencies are arranged so that by the time you write a file, every
module it imports already exists. Resist jumping ahead to a later file or a later
milestone — a half-built milestone leaves the tree in a state the next milestone
was not written to start from.

When you begin a milestone, skim its Goal and acceptance check first so you know
the target you are building toward. When you think you are finished, **re-run the
acceptance command** and confirm it is green. The command passing is the
definition of done; "it looks complete" is not.

## Read the implementer notes

The "Notes for the implementer" section is where the traps live — for example,
the Burrau golden test uses `N_max = 256` rather than the production default of
64, and its reference JSON ships with placeholder positions that must be
regenerated against your own high-precision run on first landing. Missing a note
like this produces a test that passes for the wrong reason. Always read them
before closing out the milestone.

## Conventions inherited from M0

M0 fixes the project conventions; every later file matches them:

- **ESM throughout.** `package.json` has `"type": "module"`. Imports use explicit
  `.js` extensions even for `.ts` sources (`import { run } from
  '@/integrate/run.js'`).
- **Path alias.** `@/*` resolves to `src/*` (configured in both `tsconfig.json`
  and `vitest.config.ts`). Import application code via `@/...`, not long relative
  paths.
- **Strict TypeScript.** `strict` is on, plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`, and `isolatedModules`. Write code that satisfies
  these — index access is possibly-undefined, optional properties are exact.
  Target is ES2022.
- **Barrel exports.** Each module exposes its public surface through an
  `index.ts` that re-exports the module's files. New modules follow the same
  pattern so consumers import from the module, not from individual files.
- **Vitest** for tests (see the `principia-testing` skill).

When you scaffold a new module, mirror this structure: typed `types.ts` where
needed, the implementation files, an `index.ts` barrel, and a matching
`test/unit/<module>/` directory.

## Living-document discipline

The spec and milestones are living documents. Two consequences:

- **Keep contracts stable across milestones.** Later layers add capability
  *without changing* the contracts earlier layers established — `SimResult`, the
  decoder signature, the chart contract, the tile identity. The three-layer tile
  architecture is explicitly designed so Layer 1 and Layer 2 don't break Layer
  0's contracts (see the `principia-architecture` skill). Don't quietly redefine
  a shared struct or interface to suit the current milestone.
- **Surface divergence rather than drifting.** If the implementation needs to
  depart from the spec (a better parameterisation, a constant that needs
  changing), note the divergence explicitly so the living document can catch up,
  instead of silently letting code and spec disagree.

## Land one coherent green state at a time

Prefer completing a milestone fully — all listed files, all tests, the
acceptance command green — over scattering partial work across several
milestones. One milestone equals one coherent, testable, green checkpoint. That
is what makes the next milestone safe to start.

## Before you call a milestone done — checklist

- Did you implement every file in the milestone's file tree, in order?
- Did you read the "Notes for the implementer"?
- Does new code follow the M0 conventions (ESM `.js` imports, `@/` alias, strict
  TS, barrel `index.ts`)?
- Did you avoid changing any contract an earlier milestone established?
- Did the acceptance command actually run green, with the stated test count?
