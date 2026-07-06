import { describe, it, expect } from 'vitest';
import {
  emptyWord, appendSymbol, wordToString, freeGroupTick, pickEndpoint,
} from '@/metrics/free_group.js';
import { SYMBOL } from '@/metrics/types.js';

describe('symbol append and free reduction', () => {
  it('appends symbols in order', () => {
    let w = emptyWord();
    w = appendSymbol(w, SYMBOL.a);
    w = appendSymbol(w, SYMBOL.b);
    w = appendSymbol(w, SYMBOL.A);
    w = appendSymbol(w, SYMBOL.B);
    expect(wordToString(w)).toBe('abAB');
  });

  it('reduces aA on append', () => {
    let w = emptyWord();
    w = appendSymbol(w, SYMBOL.a);
    w = appendSymbol(w, SYMBOL.A);
    expect(wordToString(w)).toBe('');
    expect(w.length).toBe(0);
  });

  it('reduces nested cancellations one at a time', () => {
    let w = emptyWord();
    w = appendSymbol(w, SYMBOL.a);
    w = appendSymbol(w, SYMBOL.b);
    w = appendSymbol(w, SYMBOL.B);   // cancels with previous
    expect(wordToString(w)).toBe('a');
  });

  it('truncates at 58 symbols', () => {
    let w = emptyWord();
    for (let i = 0; i < 70; i++) {
      w = appendSymbol(w, SYMBOL.a);
    }
    expect(w.truncated).toBe(true);
    expect(w.length).toBe(58);
  });
});

describe('branch-cut endpoint', () => {
  it('picks north for an equator BC', () => {
    expect(pickEndpoint([1, 0, 0])).toEqual([0, 0, 1]);
  });

  it('falls back to south when b̂ is near the north pole', () => {
    expect(pickEndpoint([0.05, 0, 0.999])).toEqual([0, 0, -1]);
  });
});

describe('freeGroupTick', () => {
  const b1 = [1, 0, 0] as const;
  const b2 = [-0.5, Math.sqrt(3)/2, 0] as const;

  it('crossing the C_a cut from above to below appends one symbol', () => {
    // C_a is the great circle through b1 = (1,0,0) and (0,0,1). Plane
    // normal b×ê points along -y ... sign flips when n crosses y = 0 far
    // from the b2 cut.
    let w = emptyWord();
    const prev = [0.5, 0.866, 0] as const;
    const cur  = [0.5, -0.866, 0] as const;
    w = freeGroupTick(w, prev, cur, b1 as any, b2 as any);
    expect(w.length).toBe(1);
  });
});
