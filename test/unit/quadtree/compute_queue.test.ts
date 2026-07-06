import { describe, it, expect } from 'vitest';
import { FifoComputeQueue } from '@/quadtree/compute_queue.js';

describe('FifoComputeQueue', () => {
  it('preserves insertion order', () => {
    const q = new FifoComputeQueue();
    q.push({ z: 1, tx: 0, ty: 0 });
    q.push({ z: 1, tx: 1, ty: 0 });
    expect(q.pop()).toEqual({ z: 1, tx: 0, ty: 0 });
    expect(q.pop()).toEqual({ z: 1, tx: 1, ty: 0 });
  });

  it('deduplicates pending requests', () => {
    const q = new FifoComputeQueue();
    q.push({ z: 1, tx: 0, ty: 0 });
    q.push({ z: 1, tx: 0, ty: 0 });
    q.push({ z: 1, tx: 0, ty: 0 });
    expect(q.queued).toBe(1);
  });

  it('declines duplicate inflight tiles too', () => {
    const q = new FifoComputeQueue();
    q.push({ z: 1, tx: 0, ty: 0 });
    q.pop();             // moves into inflight
    q.push({ z: 1, tx: 0, ty: 0 });
    expect(q.queued).toBe(0);
  });

  it('done() removes from the inflight set', () => {
    const q = new FifoComputeQueue();
    q.push({ z: 1, tx: 0, ty: 0 });
    const t = q.pop()!;
    q.done(t);
    expect(q.size).toBe(0);
  });

  it('flush() drops queued but keeps inflight', () => {
    const q = new FifoComputeQueue();
    q.push({ z: 1, tx: 0, ty: 0 });
    q.push({ z: 1, tx: 1, ty: 0 });
    q.pop();             // first goes inflight
    q.flush();
    expect(q.queued).toBe(0);
    expect(q.running).toBe(1);
  });
});
