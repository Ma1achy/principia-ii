import { sizeOfSimResult } from '@/gpu/structs.js';

const MAGIC   = 0x504e4350;     // little-endian bytes read "PCNP"
const VERSION = 1;

/**
 * Header (64 bytes):
 *   [0..3]    magic   "PCNP" (ASCII, little-endian u32)
 *   [4..7]    version u32
 *   [8..11]   width   u32
 *   [12..15]  height  u32
 *   [16..19]  M       u32
 *   [20..23]  reserved
 *   [24..55]  view-hash: the full 32-byte SHA-256 digest of the
 *             serialised ViewState (a SHA-256 digest is 32 bytes — the
 *             original spec sketch said 40, which no digest fills)
 *   [56..63]  reserved
 */
export function encodeBinary(
  width: number, height: number, M: number,
  viewHash: Uint8Array, payload: ArrayBuffer,
): ArrayBuffer {
  const stride = sizeOfSimResult(M);
  const total = 64 + width * height * stride;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, VERSION, true);
  dv.setUint32(8, width, true);
  dv.setUint32(12, height, true);
  dv.setUint32(16, M, true);
  // bytes 20..23 reserved
  new Uint8Array(out, 24, 32).set(viewHash.subarray(0, 32));
  // bytes 56..63 reserved
  new Uint8Array(out, 64).set(new Uint8Array(payload));
  return out;
}

export function decodeBinaryHeader(ab: ArrayBuffer): {
  magic: number; version: number;
  width: number; height: number; M: number;
  viewHash: Uint8Array;
} {
  const dv = new DataView(ab);
  return {
    magic:    dv.getUint32(0, true),
    version:  dv.getUint32(4, true),
    width:    dv.getUint32(8, true),
    height:   dv.getUint32(12, true),
    M:        dv.getUint32(16, true),
    viewHash: new Uint8Array(ab, 24, 32),
  };
}

export { MAGIC as BINARY_MAGIC, VERSION as BINARY_VERSION };
