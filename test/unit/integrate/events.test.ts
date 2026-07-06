import { describe, it, expect } from 'vitest';
import { tickEscapeGates, makeEscapeState, collisionCheck } from '@/integrate/events.js';

describe('collisionCheck', () => {
  it('fires at small r_min', () => {
    const s = {
      m: [1/3, 1/3, 1/3] as const,
      r: [[0, 0], [1e-5, 0], [10, 10]] as const,
      p: [[0,0],[0,0],[0,0]] as const, t: 0.4,
    };
    const term = collisionCheck(s, 1e-4);
    expect(term?.kind).toBe('COLLISION');
    if (term?.kind === 'COLLISION') {
      expect(term.pair).toBe(0);
      expect(term.t).toBe(0.4);
    }
  });

  it('does not fire when bodies are well separated', () => {
    const s = {
      m: [1/3,1/3,1/3] as const,
      r: [[0,0],[1,0],[0,1]] as const, p: [[0,0],[0,0],[0,0]] as const, t: 0,
    };
    expect(collisionCheck(s, 1e-4)).toBeNull();
  });
});

describe('escape persistence', () => {
  it('requires k_esc consecutive on-frames before declaring escape', () => {
    // Body 2 receding outward fast; bodies 0,1 nearby.
    const m = [1/3,1/3,1/3] as const;
    const s = {
      r: [[0,0],[0.5,0],[20,0]] as const,
      p: [[0,0],[0,0],[5,0]] as const,
      m, t: 0,
    };
    const st = makeEscapeState();
    // Single tick should not fire.
    expect(tickEscapeGates(s, st, 10, 8).fired).toBe(false);
    // Eight ticks at the same configuration should.
    let last = false;
    for (let i = 0; i < 8; i++) {
      last = tickEscapeGates(s, st, 10, 8).fired;
    }
    expect(last).toBe(true);
  });

  it('decay: a single off-frame walks the counter back', () => {
    const m = [1/3,1/3,1/3] as const;
    const sFar = {
      r: [[0,0],[0.5,0],[20,0]] as const,
      p: [[0,0],[0,0],[5,0]] as const,
      m, t: 0,
    };
    const sNear = {
      r: [[0,0],[0.5,0],[0.1,0]] as const,            // body 2 came back close
      p: [[0,0],[0,0],[0,0]] as const,
      m, t: 0,
    };
    const st = makeEscapeState();
    for (let i = 0; i < 5; i++) tickEscapeGates(sFar, st, 10, 8);
    expect(st.counters[2]).toBe(5);
    tickEscapeGates(sNear, st, 10, 8);
    expect(st.counters[2]).toBe(4);
  });
});
