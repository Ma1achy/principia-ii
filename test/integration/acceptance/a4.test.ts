import { describe, it, expect } from 'vitest';
import '@/validation/index.js';        // registers all six
import { acceptanceTests } from '@/validation/acceptance.js';

describe('Architectural acceptance', () => {
  it('A4 passes', async () => {
    const t = acceptanceTests.find((x) => x.id === 'A4')!;
    const r = await t.run();
    expect(r.details ?? '').toBeDefined();
    expect(r.passed).toBe(true);
  });
});
