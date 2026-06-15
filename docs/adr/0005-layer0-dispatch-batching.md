# ADR 0005: Layer-0 dispatch batching under WebGPU timeouts

- **Status:** Accepted (ratified into the spec 2026-06-15)
- **Date:** 2026-06-15
- **Gates:** M3
- **Recommendation:** Adopt fixed-size dispatch chunks (each chunk = one compute pass = one tile, 256x256 samples) submitted in centre-out raster order, one queue submit per chunk, with a per-frame generation token that lets the render loop abandon remaining chunks the instant the camera moves.

---

## Context

Layer 0 (§6.1.1, "Layer 0: flat grid, no cache") is the first end-to-end pass through WebGPU and the milestone that lands the shared data contracts (`SimResult`, `ICDescriptor`, `SimUniforms`, `TileRequest`). The spec describes Layer 0 as: the viewport "divided into a fixed grid of tiles ... **All tiles are dispatched**, each producing $N^2$ `SimResult` records in a GPU storage buffer," and "Panning or zooming **recomputes everything**" (§6.1.1).

Taken literally, "all tiles are dispatched" each frame is unimplementable at the base level. A base-level grid spanning the viewport can be tens of thousands of tiles, and WebGPU enforces per-dispatch timeouts: a single oversized compute pass is killed by the implementation (TDR / device-lost) with no partial result. The principia-gpu skill states the rule plainly: "**Tiles are the dispatch unit, always.** You cannot submit a million-sample job in one compute pass — WebGPU enforces dispatch timeouts," and "**Dispatches cannot be cancelled mid-flight** ... you can only skip *subsequent* passes ... Design multi-pass work so it can bail between passes."

The spec already gives the resolution pattern, but only in the **export** path (§5, "Dispatch structure"): "A $4096\times4096$ render cannot be submitted as a single compute dispatch (WebGPU timeout limits). Instead, the viewport is partitioned into a regular grid of *dispatch chunks* — fixed-size sub-regions (e.g. $256\times256$ pixels each) dispatched sequentially in raster order. Each chunk is a self-contained compute pass identical to one tile in the interactive pipeline." The WebGPU execution model section (§6, "Dispatch") confirms the per-pass shape: "For a tile with `SAMPLES_PER_TILE_AXIS` $=N$, dispatch a 2D grid of $N\times N$ invocations."

What is **undecided and omitted** for Layer 0 specifically: the spec never states the concrete interactive batching rule — the chunk size, the raster order, how many `queue.submit` calls happen per frame, and how the loop bails between chunks when the camera moves. The current M3 code (`src/gpu/dispatch_layer0.ts` in `milestones/M3_layer0_gpu.md`) sidesteps this entirely: it does exactly one compute pass + one render pass over a single tile that fills the viewport, with one `device.queue.submit([...])`. That is fine for the 16×16 M3 gate but does not generalise, and it leaves the batching contract unwritten.

This is an open contract that gates M3 and is inherited unchanged by M4 (Layer 1 cache) and M5 (Layer 2 refinement), whose data flow is "identical to Layer 0." Multiple build agents will write the dispatch loop, the scheduler stub, and the export path against it. If each agent picks its own chunk size, submit granularity, or bail mechanism, the buffers, bind groups, and tests diverge silently — exactly the failure the principia-gpu skill warns is "non-negotiable on the GPU path." It must be decided once and recorded.

## Options

### Option A — One giant dispatch (literal reading of §6.1.1)

How it works: allocate one `SimResult` buffer covering every visible sample and issue a single `dispatchWorkgroups` over the whole grid in one compute pass, one submit per frame. This is what "all tiles are dispatched" reads like at face value.

- Pros: trivial code; matches the literal spec sentence; one submit, simplest scheduling.
- Cons: **violates the device timeout** at any realistic viewport — the pass is killed (device-lost) with no partial output; the buffer also blows past the baseline `maxStorageBufferBindingSize` of 128 MiB (208 B/sample × $1024^2$ ≈ 208 MiB, per §5 "WebGPU buffer-size limit"); cannot bail on camera move because there is nothing to bail between; directly contradicts the skill's "tiles are the dispatch unit, always."
- Implementation cost: lowest to write, but non-viable — it fails in the field, not in review.

### Option B — Fixed-size dispatch chunks, centre-out, one submit per chunk, generation-token bail (recommended)

How it works: partition the visible region into a regular grid of fixed-size **dispatch chunks**, where one chunk == one tile == one self-contained compute pass of $N\times N$ samples (the §5 export pattern, reused interactively). Concretely: chunk size is the tile, with `SAMPLES_PER_TILE_AXIS` $N\in\{8,16,32\}$ samples per axis and the raster footprint capped so a chunk never exceeds the §5 guideline of ~256×256 rendered pixels. Chunks are emitted in **centre-out raster order** (nearest the viewport centre first) so the focus region sharpens first. Each chunk records into its slot of a chunk-sized `SimResult` ring/region (never one viewport-sized buffer), keeping every buffer under the queried `maxStorageBufferBindingSize`. Submission rule: **one `device.queue.submit` per chunk** (compute pass; the render pass that composites all ready chunks runs once per frame against `target`). The loop dispatches a bounded number of chunks per animation frame (a per-frame budget, e.g. K chunks) and yields. Bail: the CPU holds a monotonically increasing `viewGeneration` token bumped on every camera change; before emitting each chunk the loop checks the token and, if it changed, **abandons all remaining chunks for the stale generation** (it cannot cancel the in-flight pass — per the skill — only skip subsequent ones) and restarts chunk emission from the new viewport centre.

- Pros: respects the device timeout (each pass is small and self-contained); respects the buffer-size cap (§5); is **the same dispatch unit the skill mandates and the same chunk the export path already uses**, so interactive and export share one code path; gives free slippy-map progressive fill (centre-out) that Layer 1 (§6.1.2) needs verbatim; bails cleanly between passes exactly as the skill prescribes. The chunk == tile identity means the M4 cache can key chunks by $(z,t_x,t_y)$ with zero rework.
- Cons: more moving parts than Option A (a chunk iterator, a per-frame budget, a generation token); requires deciding K (per-frame chunk budget) — but K is a tuning constant, not a contract, so agents can converge on a default and adjust.
- Implementation cost: moderate. The compute/render passes already exist in `dispatch_layer0.ts`; this wraps them in a chunk iterator + generation guard and replaces the single submit with one-submit-per-chunk.

### Option C — Fixed chunks, but batch many chunks into one command encoder / one submit per frame

How it works: same chunking as B, but coalesce all of a frame's chunks into a single `CommandEncoder` and issue one `queue.submit` per frame containing many compute passes.

- Pros: fewer submit calls (less CPU/driver overhead per frame); still avoids the giant-dispatch timeout because each *pass* inside the encoder is small.
- Cons: the camera-move bail is **coarser** — once an encoder is submitted you cannot drop the passes already encoded into it, so a mid-frame camera move still pays for a whole frame's worth of stale chunks before the next generation can start; couples "how many chunks per frame" to "how often we can bail," which is the property we most want decoupled for a responsive microscope. Marginally harder to attribute per-chunk timing for the M5 `computeCostMs` field.
- Implementation cost: similar to B; the difference is encoder/submit granularity, a few lines.

## Decision

**Adopt Option B.** Fixed-size dispatch chunks where one chunk == one tile == one self-contained $N\times N$ compute pass; chunks emitted **centre-out in raster order**; **one `queue.submit` per chunk**; a bounded number of chunks dispatched per animation frame; and a CPU-held `viewGeneration` token that causes the loop to **skip all remaining chunks of a stale generation** the instant the camera moves (in-flight passes are allowed to finish, never cancelled).

Rationale, in priority order:

1. **It is the only option that satisfies the WebGPU science.** Option A is killed by the device timeout and the 128 MiB buffer cap; it cannot bail. B is the spec's own §5 dispatch-chunk pattern and the skill's "tiles are the dispatch unit, always" applied to the interactive loop.
2. **It is the simplest option that also serves the multi-agent build.** B reuses one chunk == tile abstraction across Layer 0, Layer 1's cache (keyed by $(z,t_x,t_y)$), and the export path (§5) — so the dispatch contract written for M3 is the same one M4 and M5 inherit, and the same one the export agent reuses. That is fewer total abstractions than letting export and interactive diverge.
3. **Per-chunk submit (B) over per-frame submit (C)** because responsiveness of the projective microscope is a stated product goal and the camera moves constantly. Per-chunk submit lets the bail granularity equal one chunk; C makes bail granularity one frame. C's only advantage is submit-call overhead, which is not the bottleneck (the integration compute dominates). Choose the finer bail.

Concrete defaults to record (chunk size and per-frame budget are tuning constants, not contract): chunk = one tile of `SAMPLES_PER_TILE_AXIS` samples per axis ($N$, default 16 for interactive Preview/Balanced), rendered footprint capped at ~256×256 px per §5; centre-out raster order; per-frame chunk budget K defaulting to a small constant (start at K = 8, tune against frame time). The **contract** is: chunk == tile == one compute pass; one submit per chunk; centre-out order; generation-token bail between chunks.

This is a recommendation for human ratification.

## Consequences

Downstream artifacts that must reflect this decision:

- **`src/gpu/dispatch_layer0.ts`** (M3): generalise from "single tile = viewport, one submit" to a chunk loop. It gains a chunk iterator (centre-out over visible tiles), a `viewGeneration: number` parameter, a per-frame chunk budget, and one `queue.submit` per chunk; the render pass stays once per frame over `target`. The existing single-tile path becomes the degenerate case (one chunk).
- **`src/gpu/buffers.ts`** (`createTileBuffers`): the `simResults` / `icDesc` allocations must be sized **per chunk** (or a small ring of chunk-sized regions), not viewport-sized, and must clamp against `ctx.limits.maxStorageBufferBindingSize` queried in `init.ts`. The current `sizeOfSimResult(M) * N * N` (one tile) is already chunk-sized — keep it chunk-scoped, do not scale it to the viewport.
- **`TileRequest`** struct (`src/gpu/structs.ts` + `simulate.wgsl` + alignment pin test): unchanged in layout — it already carries `uv_centre`, `uv_half`, and `(z,tx,ty,level)`, which is exactly the per-chunk identity this decision needs. No new fields. This decision confirms `TileRequest` is the chunk-dispatch unit, which the principia-gpu skill catalogue should note.
- **principia-gpu SKILL.md**: the "Dispatch and workgroups" section should cross-reference this ADR as the authority for the interactive batching rule (chunk == tile, one submit per chunk, centre-out, generation-token bail), so it reads consistently with "tiles are the dispatch unit, always."
- **M3 milestone (`milestones/M3_layer0_gpu.md`)**: the "Single tile = viewport" note and `dispatch_layer0.ts` listing must be updated to present the single tile as a one-chunk special case of the chunk loop, and to add the generation-token parameter.
- **M4 (Layer 1)**: the cache keys chunks by $(z,t_x,t_y)$ — guaranteed compatible because the chunk *is* the tile. The FIFO compute queue dispatches one chunk per submit using this same path.
- **M5 (Layer 2)** and **`Tile.computeCostMs`**: per-chunk submit makes per-tile timing directly attributable, feeding the priority/eviction logic in §6.4 (Scheduling).
- **Export path (§5)**: must call the same chunk-dispatch primitive with adaptive/priority/bail disabled and full raster order (no centre-out, no generation bail) — confirming the spec's "the difference is orchestration only."

## Verification

Pin the decision with a Layer-0 dispatch test (`test/integration/layer0_dispatch_chunking.test.ts`, WebGPU-gated like the existing M3 integration tests) asserting the **observable contract**, not the tuning constants:

1. **Chunk size is bounded.** Construct a view whose visible region spans more than one chunk and assert that the dispatch loop issues more than one `queue.submit`, and that no single compute pass dispatches a grid larger than one tile ($N\times N$ samples / ~256² px). Spy on `device.queue.submit` to count calls. This fails loudly if any agent reverts to Option A's giant dispatch.
2. **One submit per chunk.** Assert `submit` call count equals the number of emitted chunks for that frame (distinguishes B from C; if a future change batches into one encoder, this test must be consciously updated, preventing silent drift).
3. **Centre-out order.** Assert the first chunk dispatched is the one containing the viewport centre, and that chunk distances from centre are non-decreasing in emission order.
4. **Generation-token bail.** Drive the loop with a low per-frame budget, bump `viewGeneration` after the first chunk, and assert that **no further chunks of the stale generation** are submitted, while the already-in-flight chunk is allowed to complete (never cancelled). This pins the skill's "skip subsequent passes, cannot cancel mid-flight" rule.
5. **Golden assembly fixture.** Run the existing M3 (3,4,5)-Burrau 16×16 view both as (a) a single chunk and (b) artificially split into 4 chunks of 8×8, and assert the assembled `SimResult` buffers are **bitwise identical**. This guarantees chunking is purely a submission-order concern with no effect on results — the load-bearing invariant that lets export and interactive share one path.

These five assertions, gated in CI when a WebGPU adapter is present, make the chunk size bound, the submit granularity, the order, and the bail mechanism impossible to change accidentally without a red test.
