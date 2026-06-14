---
name: principia-testing
description: >-
  Testing conventions for Principia: the Vitest setup and how to run a single
  suite, the test/unit/<module> and test/golden layout, floating-point tolerance
  discipline, golden/reference fixtures (generate once with a high-precision run,
  then pin), the struct-alignment pin tests, decode-landmark tests, and the
  per-milestone acceptance check as the definition of done. Use this skill
  whenever writing or editing any *.test.ts file, adding or regenerating a golden
  or reference fixture, defining a milestone acceptance check, choosing a numeric
  tolerance for an assertion, or touching vitest.config.ts or the CI gate. Apply
  it even for a one-line assertion: a careless float comparison or a hand-faked
  reference silently defeats the golden-test safety net the whole project relies
  on.
---

# Principia testing conventions

Principia's correctness guarantees do not live in the prose of the spec — they
live in the tests. The golden tests are what stop a "harmless" integrator tweak
from silently shifting every trajectory, and the alignment tests are what stop a
struct edit from corrupting every pixel. Treat tests as load-bearing, not as a
chore appended after the code.

## Running tests

The runner is **Vitest**. `package.json` exposes:

- `npm test` — run the full suite (`vitest`),
- `npm run typecheck` — `tsc --noEmit`,
- `npm run lint` — eslint over `src` and `test`.

To run a single suite, pass through to vitest with `--run` and a path:

```bash
npm test -- --run test/unit/math
npm test -- --run test/golden/burrau
```

The double dash is required — everything after it goes to vitest. Coverage is the
v8 provider. The config globs `test/**/*.test.ts` and wires the `@/` alias to
`src/`, so tests import application code as `@/integrate/run.js` (note the `.js`
extension — this is an ESM project).

## Layout: tests mirror source

```
test/
  unit/
    math/        scalar.test.ts, vec.test.ts, ...
    integrate/   forces.test.ts, kdk.test.ts, yoshida.test.ts, events.test.ts
    decode/      mass.test.ts, canonicalise.test.ts, inverse.test.ts, ...
  golden/        burrau.test.ts + burrau_345_reference.json
                 decode_landmarks.test.ts
```

Unit tests sit under `test/unit/<module>/` next to the module they mirror.
Cross-cutting reference tests (golden trajectories, decode landmarks, struct
alignment) live in `test/golden/`. Tests that later milestones depend on are
written **early** — M0 lands at least 30 green math tests before any physics
exists, because M1 and M2 lean on them.

## The acceptance check is the definition of done

Every milestone ends with an **acceptance check**: a single exact command that
must pass, with a stated green-test count or condition. For example, M0's exit
criterion is `npm test -- --run test/unit/math` passing with 30+ green tests;
M1's is `test/golden/burrau.test.ts` passing with energy drift below `1e-7`, the
terminal label `ESCAPE` for body 1, and all checkpoints within `0.02`.

Run the acceptance command and see it green before declaring a milestone done.
"Looks right" is not done; the command passing is done.

## Floating-point assertions

Trajectories and decodes are floating-point — **never** assert exact equality on
a float. Use a deliberate tolerance:

```ts
// position agreement within a chosen tolerance
expect(Math.hypot(dx, dy)).toBeLessThan(REF.tolerance_position); // e.g. 0.02
// scalar closeness
expect(energyDrift).toBeLessThan(1e-7);
```

Never `toBe`/`toEqual` on a computed float. Choose each tolerance for a reason
and write it where a reader can see it (the golden fixture carries
`tolerance_position` and `energy_drift_max` as named fields). Integer outcomes
(terminal kind, escaping body index, pair codes) are exact and may be compared
directly.

## Golden / reference fixtures

The pattern that makes regressions diff-visible:

1. **Generate the reference once** with a high-precision run — the Burrau
   reference is produced by Yoshida 6 at `dt = 1e-4` — and commit it as JSON
   (`test/golden/burrau_345_reference.json`).
2. The test re-runs the pipeline and asserts agreement with the committed
   reference to within the fixture's stated tolerance.
3. Any later change that shifts results beyond tolerance fails the test and shows
   up as a reviewable diff.

Two rules that are easy to get wrong:

- **Regenerate placeholders on first landing.** A fixture committed before the
  feature exists carries *illustrative* numbers. When you first implement the
  feature, run the high-precision integrator, capture the **actual** values, and
  commit those as the real reference. Do not ship placeholder shapes as if they
  were ground truth, and do not hand-edit reference numbers to make a failing
  test pass — that is exactly the regression the golden test is meant to catch.
- **The golden config is not the production config.** Golden tests use the
  reference integrator and settings (Yoshida 6, `N_max = 256`) even though the
  GPU pipeline runs KDK at `N_max = 64` in Preview tier. The golden test pins the
  *reference truth*; it is not measuring the production speed/accuracy
  trade-off. Keep the two straight.

## Struct-alignment pin tests

Every GPU struct that crosses the CPU/GPU boundary has its byte size asserted in
`test/.../layer0_struct_alignment.test.ts`. When you change a struct field, the
size assertion must change in the **same commit** as the WGSL struct and the
TypeScript packer (see the `principia-gpu` skill). This test is the tripwire for
silent layout corruption — never weaken it to make an edit pass; fix the layout.

## Decode-landmark tests

`decode_landmarks` pins known IC points through the decoder so that any change to
a chart, decoder, or canonicaliser that moves a landmark is caught. When you add
or modify a chart, add or update its landmark so the chart's behaviour is
anchored.

## Determinism and CI

The integrator and decoder are deterministic, and the golden tests depend on it.
Keep `Math.random` out of trajectory and decode paths; ensemble jitter must use a
seeded generator so runs reproduce. The CI gate is simply that a fresh clone runs
`npm install && npm test` green, with `typecheck` and `lint` also clean — keep
all three green at every milestone boundary.

## Before you finish any test change — checklist

- Does every float assertion use an explicit, visible tolerance (never exact
  equality)?
- If you touched a golden fixture, did you regenerate it from a high-precision
  run rather than hand-editing numbers?
- If you changed a GPU struct, did the alignment pin test change in the same
  commit?
- Does the milestone's acceptance command actually pass, green, with the stated
  count?
- Are typecheck and lint still clean?
