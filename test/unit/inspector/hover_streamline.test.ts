import { describe, it, expect } from 'vitest';
import { HoverStreamline } from '@/inspector/hover_streamline.js';

describe('hover streamline debouncing', () => {
  it("only the most recent move's session produces a result", async () => {
    const hs = new HoverStreamline();
    let calls = 0;
    const decode = () => {
      calls++;
      return {
        m: [1/3,1/3,1/3] as any,
        r: [[1,0],[-0.5, Math.sqrt(3)/2],[-0.5,-Math.sqrt(3)/2]] as any,
        p: [[0,0],[0,0],[0,0]] as any, t: 0,
      };
    };
    hs.onMove(decode);
    hs.onMove(decode);
    hs.onMove(decode);
    await new Promise(r => setTimeout(r, 60));
    // Only the third move actually integrates.
    expect(calls).toBe(1);
    expect(hs.trajectory().length).toBeGreaterThan(0);
  });
});
