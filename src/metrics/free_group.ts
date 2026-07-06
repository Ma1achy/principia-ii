import type { Vec3 } from '@/math/types.js';
import { cross3, dot3 } from '@/math/vec.js';
import type { FreeGroupWord } from './types.js';
import { SYMBOL, FREE_GROUP_MAX_LENGTH } from './types.js';

const NORTH: Vec3 = [0, 0,  1];
const SOUTH: Vec3 = [0, 0, -1];

/** Pick a branch-cut endpoint for a collision singularity b̂. The default
 *  is the north pole; if b̂ is too close to the north pole (extreme mass
 *  ratios), fall back to the south. */
export function pickEndpoint(b: Vec3, threshold = 0.1): Vec3 {
  const cr = cross3(b, NORTH);
  const sin = Math.hypot(cr[0], cr[1], cr[2]);
  return sin < threshold ? SOUTH : NORTH;
}

/** Signed distance of n from the great-circle plane through (b̂, ê). */
function signedPlane(n: Vec3, b: Vec3, e: Vec3): number {
  const cr = cross3(b, e);
  return dot3(n, cr);
}

export function emptyWord(): FreeGroupWord {
  return { bits: [0, 0, 0, 0], length: 0, truncated: false };
}

function setBitPair(bits: [number,number,number,number], slot: number, sym: number): void {
  const lane = slot >> 4;          // 0,1,2,3
  const off  = (slot & 0xf) * 2;   // bit offset in the lane
  // Clear and set within the slot.
  bits[lane] = (bits[lane]! & ~(0x3 << off)) | ((sym & 0x3) << off);
}

function getBitPair(bits: readonly [number,number,number,number], slot: number): number {
  const lane = slot >> 4;
  const off  = (slot & 0xf) * 2;
  return (bits[lane]! >>> off) & 0x3;
}

/** Append one symbol with on-the-fly free reduction. */
export function appendSymbol(
  word: FreeGroupWord, sym: number,
): FreeGroupWord {
  if (word.length >= FREE_GROUP_MAX_LENGTH) {
    return { ...word, truncated: true };
  }
  // Free reduction: aA / Aa / bB / Bb cancels.
  if (word.length > 0) {
    const last = getBitPair(word.bits, word.length - 1);
    const cancels =
      (last === SYMBOL.a && sym === SYMBOL.A) ||
      (last === SYMBOL.A && sym === SYMBOL.a) ||
      (last === SYMBOL.b && sym === SYMBOL.B) ||
      (last === SYMBOL.B && sym === SYMBOL.b);
    if (cancels) {
      const bits: [number,number,number,number] = [...word.bits] as any;
      setBitPair(bits, word.length - 1, 0);
      return { bits, length: word.length - 1, truncated: word.truncated };
    }
  }
  const bits: [number,number,number,number] = [...word.bits] as any;
  setBitPair(bits, word.length, sym);
  return { bits, length: word.length + 1, truncated: word.truncated };
}

/** Step the free-group word for one macro step's progression of n. */
export function freeGroupTick(
  word: FreeGroupWord,
  prevN: Vec3, currentN: Vec3,
  b1: Vec3, b2: Vec3,
): FreeGroupWord {
  let w = word;
  for (const [b, posSym, negSym] of [
    [b1, SYMBOL.a, SYMBOL.A] as const,
    [b2, SYMBOL.b, SYMBOL.B] as const,
  ]) {
    const e = pickEndpoint(b);
    const dPrev = signedPlane(prevN,    b, e);
    const dCurr = signedPlane(currentN, b, e);
    if (dPrev === 0 || dCurr === 0) continue;
    if (Math.sign(dPrev) !== Math.sign(dCurr)) {
      const sym = dPrev > 0 ? posSym : negSym;
      w = appendSymbol(w, sym);
    }
  }
  return w;
}

/** Render a word back to a human-readable string for tests / overlays. */
export function wordToString(w: FreeGroupWord): string {
  const out: string[] = [];
  for (let i = 0; i < w.length; i++) {
    const sym = getBitPair(w.bits, i);
    out.push(sym === SYMBOL.a ? 'a' : sym === SYMBOL.A ? 'A'
            : sym === SYMBOL.b ? 'b' : 'B');
  }
  return out.join('');
}
