import { describe, it, expect } from 'vitest';
import { validateImports } from '@/gpu/wgsl/validate.js';
import { parseDirectives } from '@/gpu/wgsl/parse_imports.js';
import type { ShaderUnit } from '@/gpu/wgsl/symbol_index.js';

function unit(path: string, src: string): ShaderUnit {
  const d = parseDirectives(src);
  return { path, source: src, imports: d.imports, exports: d.exports };
}

describe('validateImports', () => {
  it('reports an unresolved target', () => {
    const units = new Map([
      ['a.wgsl', unit('a.wgsl',
        `// @import { foo } from "./missing.wgsl"\nfn entry() {}`)],
    ]);
    const errs = validateImports(units);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.message).toContain('not found');
    expect(errs[0]!.unit).toBe('a.wgsl');
    expect(errs[0]!.line).toBe(1);
  });

  it('reports an unexported symbol', () => {
    const units = new Map([
      ['a.wgsl', unit('a.wgsl', `fn private() {}`)],
      ['b.wgsl', unit('b.wgsl',
        `// @import { private } from "./a.wgsl"\nfn entry() {}`)],
    ]);
    const errs = validateImports(units);
    expect(errs[0]!.message).toContain(`not @export`);
  });

  it('reports a nested import path as an error, not a throw', () => {
    const units = new Map([
      ['a.wgsl', unit('a.wgsl',
        `// @import { x } from "../outside/b.wgsl"\nfn entry() {}`)],
    ]);
    const errs = validateImports(units);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.message).toContain('nested paths');
  });

  it('reports a cycle', () => {
    const units = new Map([
      ['a.wgsl', unit('a.wgsl',
        `// @import { from_b } from "./b.wgsl"\n// @export\nfn from_a() {}`)],
      ['b.wgsl', unit('b.wgsl',
        `// @import { from_a } from "./a.wgsl"\n// @export\nfn from_b() {}`)],
    ]);
    const errs = validateImports(units);
    expect(errs.some((e) => e.message.includes('circular'))).toBe(true);
  });

  it('passes for a valid graph', () => {
    const units = new Map([
      ['lib.wgsl', unit('lib.wgsl',
        `// @export\nfn helper() {}`)],
      ['main.wgsl', unit('main.wgsl',
        `// @import { helper } from "./lib.wgsl"\nfn entry() { helper(); }`)],
    ]);
    expect(validateImports(units)).toEqual([]);
  });

  it('does not require imports for entry-owned struct references', () => {
    // integrate.wgsl references SimUniforms (declared in simulate.wgsl)
    // without importing it: the linker validates declared imports only.
    const units = new Map([
      ['lib.wgsl', unit('lib.wgsl',
        `// @export\nfn step(k: SimUniforms) -> f32 { return k.dt; }`)],
      ['entry.wgsl', unit('entry.wgsl',
        `// @import { step } from "./lib.wgsl"\nstruct SimUniforms { dt: f32 };\nfn main() {}`)],
    ]);
    expect(validateImports(units)).toEqual([]);
  });
});
