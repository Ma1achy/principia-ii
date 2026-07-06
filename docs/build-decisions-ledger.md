# Build decisions ledger

A running log of decisions made while building the milestones autonomously —
anything where the code, the milestone doc, or a default had to be chosen or
corrected. Each entry: what was decided, why, and what it touched. Newest first.

The intent (per the build authorisation) is that every non-obvious choice is
flagged here so it can be reviewed rather than buried in a diff.

---

## M0 — Foundations

Branch `feat/m0-foundations` off `webgpu-rewrite`. Acceptance gate
`npm test -- --run test/unit/math` — **green, 38 tests** (≥30 required);
`npm run typecheck` and `npm run lint` also clean.

### D0.1 — Kept the existing richer `.gitignore` instead of the milestone's 5-line one
The M0 doc specifies a minimal `.gitignore` (`node_modules`, `dist`, `coverage`,
`*.log`, `.DS_Store`). The repo already had a fuller, deliberately-authored
`.gitignore` (covers all of those plus `.claude/*` allow-listing, lockfiles,
editor cruft). Kept the existing one — it is a superset and the `.claude/`
handling is load-bearing for the skills/hooks. No functional gap versus the doc.

### D0.2 — Added a minimal `.eslintrc.cjs` (not in the M0 file tree)
`package.json` ships a `lint` script (`eslint src test --ext .ts`) and the
test/CI strategy's G8 unit job runs `lint → typecheck → test`, but the M0 file
tree lists no ESLint config, so `npm run lint` would error with "no config".
Added a minimal `.eslintrc.cjs` (`eslint:recommended` +
`@typescript-eslint/recommended`, `no-explicit-any` off for the tuple-cast math
primitives). Low-risk, unblocks the advertised script and the future CI job.

### D0.3 — Did **not** add a GitHub Actions workflow in M0
M0's Deliverable says "green CI gate," which could be read as a workflow file.
Per `docs/test-and-ci-strategy.md` ("M0 — config foundation … the *workflows*
arrive in G8"), M0 owns only the config that CI runs (`package.json` scripts +
`vitest.config`), and `.github/workflows/*` is a G8 deliverable. Kept M0 scoped
to config; the "gate" is the green `npm test`. Avoids duplicating/rewriting the
workflow in G8.

### D0.4 — Fixed two incorrect test **assertions** in the M0 doc (impls were correct)
The milestone's copy-paste tests failed against the correct implementations —
the assertions were wrong, not the code. Fixed in both the working tree and
`milestones/M0_foundations.md` (living-document discipline):

- **`sigmoid(-1000)` stability test.** Asserted `toBeGreaterThan(0)`, but
  `e^-1000 ≈ 5e-435` is below the smallest float64 subnormal, so `sigmoid`
  *correctly* saturates to exactly `0.0`. The real guarantee is finite / never
  NaN. Changed to `toBeGreaterThanOrEqual(0)` (kept the `< 1e-100` and
  `Number.isFinite` checks).
- **`smoothstep` endpoint-derivative test.** Asserted the forward-difference
  slope `< 1e-9`, but a forward difference of a function with zero first
  derivative and nonzero curvature is `O(eps) ≈ 3·eps ≈ 3e-6`, never `< 1e-9`.
  The `smoothstep` impl is the standard correct Hermite. Relaxed the threshold to
  `1e-4` (still ~5 orders below the interior slope `s'(0.5)=1.5`, so it genuinely
  tests "flat at the endpoints").

### D0.5 — Satisfied strict-mode lint/typecheck in the M0 doc's tests
Under the strict tsconfig (`noUncheckedIndexedAccess`) and ESLint, the doc's
verbatim tests didn't compile/lint clean. Fixed in tree + doc:

- Non-null assertions on in-range indexed reads in the numeric-loop assertions
  (`m2[i]!`, `m[i]!` in softmax; `lhs[i]!`, `rhs[i]!` in vec) — the indices are
  provably in bounds.
- Removed two unused imports (`scale2`, `dot3`) from `vec.test.ts`.

These are test-only edits; no production `src/math` code changed from the doc.
