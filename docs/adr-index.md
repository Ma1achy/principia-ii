# Architecture Decision Records — index

The ratified cross-milestone contracts. All seven are **Accepted** and
mirrored into `research/spec/principia_spec_revised.tex`; the canonical
records live in [`docs/adr/`](adr/README.md). Changing any of these is a
contract change: bump the cache signature and update every named gate.

| # | Contract | Why it matters |
|---|----------|----------------|
| [0001](adr/0001-checkpoint-schedule.md) | Shape-sphere checkpoint schedule | Closed-form equal spacing `t_m = m·T/M` (no `t=0` anchor, right-aligned so `t_M = T`), fixed for all tiers and charts, so the shape sphere is comparable everywhere. |
| [0002](adr/0002-outcome-class-enum.md) | Outcome-class enum → u32 | `BOUNDED=0 … TIMEOUT=4` in the low 3 bits of `sample_descriptor`, one shared source generating the TS enum and the WGSL const, locked by a parity golden. |
| [0003](adr/0003-ftle-variant-per-tier.md) | FTLE per quality tier | Full phase-space Benettin FTLE in **Research** tier only; Preview/Balanced clear `FTLE_VALID` and emit `ftle = 0`. |
| [0004](adr/0004-free-group-unequal-masses.md) | Free-group word for unequal masses | v1 validates the equal-mass F₂ word only; unequal-mass slices flag `WORD_UNCERTAIN` and never gate refinement or science on it. |
| [0005](adr/0005-layer0-dispatch-batching.md) | Layer-0 dispatch batching | Fixed-size chunks (one tile = one compute pass), centre-out order, one submit per chunk, abandonable on camera move via a generation token. |
| [0006](adr/0006-tilereduction-offset-map.md) | `TileReduction` offset map | One declarative field table in `src/gpu/structs.ts` generates the TS decoder, the WGSL struct, and a schema version — pinned by a round-trip golden. |
| [0007](adr/0007-degenerate-reason-enum.md) | `DEGENERATE(reason)` enum | A closed 8-member `DegenerateReason` (frozen codes 10–17), `COLLISION_T0` kept separate; downstream matches the enum, never strings. |

See the full text and rationale in each record; the
[ADR README](adr/README.md) has the summary table and ratification note.
