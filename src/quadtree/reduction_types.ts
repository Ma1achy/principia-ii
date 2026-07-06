import type { TileID } from './types.js';
import type { TileReductionFieldName } from '@/gpu/structs.js';

/**
 * In-memory mirror of the GPU `TileReduction` struct (272 bytes at M=8).
 * The scalar fields are the single source of truth in `TILE_REDUCTION_FIELDS`
 * (src/gpu/structs.ts); this interface derives their names from the table so
 * the two cannot drift (ADR 0006). The round-trip golden pins the byte
 * offsets.
 */
export type TileReduction =
  & {
      id:                 TileID;
      level:              number;
      mean_n_checkpoints: readonly { x: number; y: number; z: number; w: number }[];
    }
  & Record<TileReductionFieldName, number>;

/** Status-flag bit positions. Bits 6-7 are reserved for
 *  TILE_REDUCTION_SCHEMA_VERSION (stripped by decodeTileReduction). */
export const TILE_STATUS = {
  HAS_ENSEMBLE:      1 << 0,
  DECODE_LINEAR:     1 << 1,
  AT_F32_FLOOR:      1 << 2,
  SUSPECT_MAJORITY:  1 << 3,
  FTLE_VALID:        1 << 4,
  PLAYBACK_VALID:    1 << 5,
} as const;
