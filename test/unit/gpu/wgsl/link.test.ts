import { describe, it, expect } from 'vitest';
import { wgslLink } from '@/gpu/wgsl/link.js';

describe('wgslLink', () => {
  it('concatenates a single-file program with no imports', () => {
    const out = wgslLink({
      entryPath: 'a.wgsl',
      sources: { 'a.wgsl': `fn entry() {}` },
    });
    expect(out.units).toEqual(['a.wgsl']);
    expect(out.module).toContain('fn entry()');
  });

  it('emits dependencies before dependents', () => {
    const out = wgslLink({
      entryPath: 'main.wgsl',
      sources: {
        'lib.wgsl':
          `// @export\nfn helper() -> f32 { return 1.0; }`,
        'main.wgsl':
          `// @import { helper } from "./lib.wgsl"\nfn entry() { let x = helper(); }`,
      },
    });
    expect(out.units).toEqual(['lib.wgsl', 'main.wgsl']);
    expect(out.module.indexOf('helper'))
      .toBeLessThan(out.module.indexOf('entry'));
  });

  it('orders a diamond graph deterministically, each unit once', () => {
    const out = wgslLink({
      entryPath: 'main.wgsl',
      sources: {
        'base.wgsl': `// @export\nfn base() {}`,
        'left.wgsl':
          `// @import { base } from "./base.wgsl"\n// @export\nfn left() { base(); }`,
        'right.wgsl':
          `// @import { base } from "./base.wgsl"\n// @export\nfn right() { base(); }`,
        'main.wgsl': [
          '// @import { left } from "./left.wgsl"',
          '// @import { right } from "./right.wgsl"',
          'fn entry() { left(); right(); }',
        ].join('\n'),
      },
    });
    expect(out.units).toEqual(['base.wgsl', 'left.wgsl', 'right.wgsl', 'main.wgsl']);
  });

  it('strips @import / @export directives from the assembled output', () => {
    const out = wgslLink({
      entryPath: 'a.wgsl',
      sources: {
        'a.wgsl':
          `// @import { x } from "./b.wgsl"\nfn entry() {}`,
        'b.wgsl':
          `// @export\nfn x() {}`,
      },
    });
    expect(out.module).not.toContain('@import');
    expect(out.module).not.toContain('@export');
  });

  it('includes only files reachable from the entry', () => {
    const out = wgslLink({
      entryPath: 'a.wgsl',
      sources: {
        'a.wgsl':      `fn entry() {}`,
        'unused.wgsl': `fn unused() {}`,
      },
    });
    expect(out.units).not.toContain('unused.wgsl');
  });

  it('throws with a useful error on an unresolved symbol', () => {
    expect(() => wgslLink({
      entryPath: 'a.wgsl',
      sources: {
        'a.wgsl':
          `// @import { missing } from "./b.wgsl"\nfn entry() {}`,
        'b.wgsl': `fn other() {}`,
      },
    })).toThrow(/not @export/);
  });

  it('throws on a missing entry', () => {
    expect(() => wgslLink({
      entryPath: 'nope.wgsl',
      sources: { 'a.wgsl': `fn entry() {}` },
    })).toThrow(/entry "nope.wgsl" not found/);
  });

  it('throws on an import cycle with the chain in the message', () => {
    expect(() => wgslLink({
      entryPath: 'a.wgsl',
      sources: {
        'a.wgsl': `// @import { b } from "./b.wgsl"\n// @export\nfn a() {}`,
        'b.wgsl': `// @import { a } from "./a.wgsl"\n// @export\nfn b() {}`,
      },
    })).toThrow(/circular/);
  });

  it('is deterministic: identical inputs produce identical output', () => {
    const input = {
      entryPath: 'main.wgsl',
      sources: {
        'lib.wgsl':  `// @export\nfn helper() {}`,
        'main.wgsl': `// @import { helper } from "./lib.wgsl"\nfn entry() { helper(); }`,
      },
    };
    expect(wgslLink(input).module).toBe(wgslLink(input).module);
  });
});
