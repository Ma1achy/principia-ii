import type { TerminalLabel } from '@/math/types.js';
import { DegenerateReason } from './types.js';

/**
 * Classify a thrown decoder error into a closed `DegenerateReason` member
 * (ADR 0007). Unrecognised throws fall through to the named catch-all
 * `NONFINITE` — never a free string and never an open `OTHER`.
 */
function classifyDecodeError(e: unknown): DegenerateReason {
  const v = (e as { reason?: unknown } | null)?.reason;
  if (typeof v === 'number' && v >= DegenerateReason.M01_TINY
                            && v <= DegenerateReason.NONFINITE) {
    return v as DegenerateReason;
  }
  return DegenerateReason.NONFINITE;
}

/**
 * Top-level guard that ensures every decode path emits a labelled output.
 * Convert any thrown decoder error into a DEGENERATE label rather than
 * letting it bubble up to the GPU dispatch. The reason is the closed
 * `DegenerateReason` enum (ADR 0007), defaulting to `NONFINITE`.
 */
export function safeguardDecode<T>(
  fn: () => T,
  fallback: (reason: DegenerateReason) => TerminalLabel,
): T | { __terminal: TerminalLabel } {
  try {
    return fn();
  } catch (e) {
    return { __terminal: fallback(classifyDecodeError(e)) };
  }
}
