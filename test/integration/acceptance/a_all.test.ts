import { describe, it, expect } from 'vitest';
import '@/validation/index.js';
import { runAllAcceptance } from '@/validation/acceptance.js';

describe('Architectural acceptance — all', () => {
  it('every check passes', async () => {
    const all = await runAllAcceptance();
    expect(all.map((r) => r.id)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6']);
    for (const r of all) {
      expect(r.passed, `${r.id} ${r.name}: ${r.details ?? ''}`).toBe(true);
    }
  });
});
