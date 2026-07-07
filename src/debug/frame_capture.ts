/**
 * Deterministic frame capture. Serialise the full dispatch input (SimUniforms +
 * grid TileRequest + N/M) to JSON, reload it, and re-dispatch to reproduce a
 * frame exactly. M3's dispatch is a pure function of (SimUniforms, TileRequest),
 * so byte-identical packed inputs ⇒ identical GPU output. The schema is
 * versioned: M8/G7 later extend `CapturedFrame` with ViewState + ensemble seeds
 * under the same `version` gate.
 */
import type { SimUniforms, TileRequest } from '@/gpu/structs.js';
import { packSimUniforms, packTileRequest } from '@/gpu/structs.js';
import type { ChartUniforms } from '@/gpu/chart_uniforms.js';
import { packChartUniforms } from '@/gpu/chart_uniforms.js';

// v2 (G4): dispatch became a pure function of (SimUniforms, TileRequest,
// ChartUniforms) — a capture without the chart knobs would silently replay
// a different decode, so the version gate rejects v1 captures.
export const FRAME_CAPTURE_VERSION = 2 as const;

export interface CapturedFrame {
  version: number;
  N: number;
  M: number;
  uniforms: SimUniforms;
  tile: TileRequest;
  chart: ChartUniforms;
  /** Free-form note (e.g. "disagreement at (7,3)"); ignored on restore. */
  label?: string;
}

/** Capture the current dispatch input. */
export function captureFrame(
  N: number, M: number, uniforms: SimUniforms, tile: TileRequest,
  chart: ChartUniforms, label?: string,
): CapturedFrame {
  const frame: CapturedFrame = { version: FRAME_CAPTURE_VERSION, N, M, uniforms, tile, chart };
  if (label !== undefined) frame.label = label;     // exactOptionalPropertyTypes
  return frame;
}

/** Serialise to a JSON string (stable: arrays stay arrays, numbers as-is). */
export function serializeFrame(frame: CapturedFrame): string {
  return JSON.stringify(frame, null, 2);
}

/**
 * Parse + validate a captured frame. Throws on a version mismatch or missing
 * required fields — a corrupt capture should fail loudly, not silently
 * re-dispatch garbage.
 */
export function deserializeFrame(json: string): CapturedFrame {
  const raw = JSON.parse(json) as Partial<CapturedFrame>;
  if (raw.version !== FRAME_CAPTURE_VERSION) {
    throw new Error(`frame-capture version ${String(raw.version)} != ${FRAME_CAPTURE_VERSION}`);
  }
  if (raw.uniforms === undefined || raw.tile === undefined ||
      raw.chart === undefined ||
      typeof raw.N !== 'number' || typeof raw.M !== 'number') {
    throw new Error('frame-capture missing required fields');
  }
  return raw as CapturedFrame;
}

/**
 * Determinism proof used by the round-trip test: a frame and its
 * serialise→deserialise twin must produce byte-identical packed inputs.
 */
export function packedInputs(frame: CapturedFrame): {
  uniforms: ArrayBuffer; tile: ArrayBuffer; chart: ArrayBuffer;
} {
  return {
    uniforms: packSimUniforms(frame.uniforms),
    tile: packTileRequest(frame.tile),
    chart: packChartUniforms(frame.chart),
  };
}
