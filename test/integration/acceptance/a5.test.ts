import { describe, it, expect } from 'vitest';
import '@/validation/index.js';        // registers all six
import { acceptanceTests } from '@/validation/acceptance.js';

describe('Architectural acceptance', () => {
  it('A5 passes', async () => {
    const t = acceptanceTests.find((x) => x.id === 'A5')!;
    const r = await t.run();
    expect(r.details ?? '').toBeDefined();
    expect(r.passed).toBe(true);
  });
});
