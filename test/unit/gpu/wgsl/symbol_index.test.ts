import { describe, it, expect } from 'vitest';
import { resolveImport, indexUnits } from '@/gpu/wgsl/symbol_index.js';

describe('resolveImport', () => {
  it('strips ./', () => {
    expect(resolveImport('a.wgsl', './b.wgsl')).toBe('b.wgsl');
  });
  it('passes through bare paths', () => {
    expect(resolveImport('a.wgsl', 'b.wgsl')).toBe('b.wgsl');
  });
  it('rejects nested paths', () => {
    expect(() => resolveImport('a.wgsl', '../b.wgsl')).toThrow();
    expect(() => resolveImport('a.wgsl', 'sub/b.wgsl')).toThrow();
  });
});

describe('indexUnits', () => {
  it('throws on duplicate paths', () => {
    expect(() => indexUnits([
      { path: 'a', source: '', imports: [], exports: [] },
      { path: 'a', source: '', imports: [], exports: [] },
    ])).toThrow(/duplicate/);
  });
  it('indexes units by path', () => {
    const m = indexUnits([
      { path: 'a', source: 'x', imports: [], exports: [] },
      { path: 'b', source: 'y', imports: [], exports: [] },
    ]);
    expect(m.get('a')!.source).toBe('x');
    expect(m.get('b')!.source).toBe('y');
  });
});
