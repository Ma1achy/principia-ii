import { describe, it, expect } from 'vitest';
import { parseDirectives } from '@/gpu/wgsl/parse_imports.js';

describe('parseDirectives', () => {
  it('parses a named import', () => {
    const src = `// @import { foo, bar } from "./helpers.wgsl"\nfn baz() {}`;
    const d = parseDirectives(src);
    expect(d.imports).toEqual([{
      kind: 'named', symbols: ['foo', 'bar'],
      fromPath: './helpers.wgsl', line: 1,
    }]);
  });

  it('parses a namespace import', () => {
    const src = `// @import * as h from "./helpers.wgsl"`;
    expect(parseDirectives(src).imports[0]!.kind).toBe('namespace');
    expect(parseDirectives(src).imports[0]!.alias).toBe('h');
  });

  it('parses a side-effect import', () => {
    const src = `// @import "./tier_helpers.wgsl"`;
    expect(parseDirectives(src).imports[0]!.kind).toBe('side-effect');
  });

  it('parses an export attached to a fn', () => {
    const src = `// @export\nfn quux() -> f32 { return 1.0; }`;
    expect(parseDirectives(src).exports).toEqual([{ symbol: 'quux', line: 2 }]);
  });

  it('parses exports of structs and consts', () => {
    const src = [
      '// @export',
      'struct State { t: f32 };',
      '// @export',
      'const PI: f32 = 3.14;',
    ].join('\n');
    expect(parseDirectives(src).exports.map((e) => e.symbol))
      .toEqual(['State', 'PI']);
  });

  it('keeps a pending @export across comments and blank lines', () => {
    // Doc comments between @export and the declaration are desirable.
    const src = [
      '// @export',
      '// Computes the thing (spec §4.3).',
      '',
      'fn documented() {}',
    ].join('\n');
    expect(parseDirectives(src).exports).toEqual([{ symbol: 'documented', line: 4 }]);
  });

  it('cancels @export when followed by non-declaration code', () => {
    const src = `// @export\nvar<private> counter: u32 = 0u;\nfn nothing() {}`;
    expect(parseDirectives(src).exports).toHaveLength(0);
  });

  it('parses multiple exports interleaved with normal code', () => {
    const src = [
      'fn private_helper() {}',
      '// @export',
      'fn public_one() {}',
      '',
      '// @export',
      'struct PublicStruct { x: f32 };',
      'fn private_two() {}',
    ].join('\n');
    const d = parseDirectives(src);
    expect(d.exports.map((e) => e.symbol)).toEqual(['public_one', 'PublicStruct']);
  });
});
