import { describe, it, expect } from 'vitest';
import { RollingWindow, p95 } from '@/perf/stats.js';

describe('RollingWindow', () => {
  it('rejects a non-positive capacity', () => {
    expect(() => new RollingWindow(0)).toThrow(RangeError);
  });

  it('mean of a partial window', () => {
    const w = new RollingWindow(5);
    w.push(2); w.push(4); w.push(6);
    expect(w.size).toBe(3);
    expect(w.mean()).toBeCloseTo(4, 12);
  });

  it('evicts the oldest sample and updates the running mean', () => {
    const w = new RollingWindow(3);
    [1, 2, 3, 4].forEach(x => w.push(x));   // 1 evicted
    expect(w.toArray()).toEqual([2, 3, 4]);
    expect(w.mean()).toBeCloseTo(3, 12);
  });

  it('toArray returns oldest → newest after wraparound', () => {
    const w = new RollingWindow(3);
    [10, 20, 30, 40, 50].forEach(x => w.push(x));
    expect(w.toArray()).toEqual([30, 40, 50]);
  });

  it('percentile interpolates linearly', () => {
    const w = new RollingWindow(4);
    [1, 2, 3, 4].forEach(x => w.push(x));
    // rank for p=0.5 over 4 samples = 0.5*3 = 1.5 → between 2 and 3 = 2.5
    expect(w.percentile(0.5)).toBeCloseTo(2.5, 12);
    expect(w.percentile(0)).toBe(1);
    expect(w.percentile(1)).toBe(4);
  });

  it('p95 on a partial window does not throw and is ≤ max', () => {
    const w = new RollingWindow(120);
    [5, 5, 5, 100].forEach(x => w.push(x));
    expect(p95(w)).toBeLessThanOrEqual(100);
    expect(p95(w)).toBeGreaterThanOrEqual(5);
  });

  it('empty window yields 0 for mean and percentile', () => {
    const w = new RollingWindow(8);
    expect(w.mean()).toBe(0);
    expect(w.percentile(0.95)).toBe(0);
  });

  it('reset returns the window to the empty state', () => {
    const w = new RollingWindow(4);
    [7, 8, 9].forEach(x => w.push(x));
    w.reset();
    expect(w.size).toBe(0);
    expect(w.mean()).toBe(0);
    w.push(5);
    expect(w.toArray()).toEqual([5]);
  });
});
