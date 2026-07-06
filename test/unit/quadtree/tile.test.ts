import { describe, it, expect } from 'vitest';
import {
  tileBounds, tileCentreHalf, ancestor, children, contains, subrect, tileKey,
} from '@/quadtree/tile.js';

describe('tileBounds', () => {
  it('depth 0 covers the unit square', () => {
    expect(tileBounds({ z: 0, tx: 0, ty: 0 }))
      .toEqual({ uMin: 0, uMax: 1, vMin: 0, vMax: 1 });
  });

  it('depth 2 partition is exact', () => {
    const top = { z: 2, tx: 1, ty: 0 };
    const b = tileBounds(top);
    expect(b.uMin).toBeCloseTo(0.25, 12);
    expect(b.uMax).toBeCloseTo(0.5,  12);
    expect(b.vMin).toBe(0);
    expect(b.vMax).toBeCloseTo(0.25, 12);
  });
});

describe('tileCentreHalf', () => {
  it('centre is the mid-point of bounds, half is span/2', () => {
    const id = { z: 3, tx: 5, ty: 2 };
    const ch = tileCentreHalf(id);
    const b = tileBounds(id);
    expect(ch.centre[0]).toBeCloseTo((b.uMin + b.uMax)/2, 12);
    expect(ch.centre[1]).toBeCloseTo((b.vMin + b.vMax)/2, 12);
    expect(ch.half[0]).toBeCloseTo((b.uMax - b.uMin)/2, 12);
    expect(ch.half[1]).toBeCloseTo((b.vMax - b.vMin)/2, 12);
  });
});

describe('ancestor / children', () => {
  it('children-of-ancestor returns the original at NW corner of the lineage', () => {
    const id = { z: 5, tx: 7, ty: 3 };
    const a = ancestor(id, 2)!;
    expect(a).toEqual({ z: 3, tx: 1, ty: 0 });
    expect(children(a)[0]).toEqual({ z: 4, tx: 2, ty: 0 });
  });

  it('ancestor walks past the root return null', () => {
    expect(ancestor({ z: 0, tx: 0, ty: 0 })).toBeNull();
  });
});

describe('contains', () => {
  it('a contains b when b is a descendant', () => {
    const a = { z: 1, tx: 0, ty: 0 };
    const b = { z: 4, tx: 1, ty: 1 };
    expect(contains(a, b)).toBe(true);
  });

  it('siblings do not contain each other', () => {
    expect(contains({ z: 2, tx: 0, ty: 0 }, { z: 2, tx: 1, ty: 0 })).toBe(false);
  });
});

describe('subrect', () => {
  it('NW-of-NW chain shrinks toward the origin corner', () => {
    const a = { z: 0, tx: 0, ty: 0 };
    const b = { z: 3, tx: 0, ty: 0 };
    expect(subrect(a, b)).toEqual([0, 0, 0.125, 0.125]);
  });

  it('NE corner of an immediate child', () => {
    const a = { z: 1, tx: 0, ty: 0 };
    const b = { z: 2, tx: 1, ty: 0 };
    expect(subrect(a, b)).toEqual([0.5, 0, 1.0, 0.5]);
  });
});

describe('tileKey', () => {
  it('is stable across canonical IDs', () => {
    expect(tileKey({ z: 4, tx: 7, ty: 2 })).toBe('4/7/2');
  });
});
