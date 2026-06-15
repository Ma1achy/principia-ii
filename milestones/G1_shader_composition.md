# G1 — Shader composition / WGSL linker

## Goal

A real cross-shader composition layer. M3, M5, M6 all ship WGSL fragments
that reference each other (`mass_softmax` from `helpers.wgsl` is called
by `decode.wgsl`; `shape_sphere` from `metrics.wgsl` is called by
`simulate.wgsl`); the milestones used a stub `concatShaders()` to glue
them, which is fragile and produces silent symbol clashes.

After G1: a `wgslLink` function that resolves `// @import` directives,
flattens the dependency graph, validates that every referenced symbol is
either defined locally or imported, and emits one syntactically-valid
shader module per pipeline.

**This milestone is a refactor, not a prerequisite (A1 ruling).** M3, M5,
and M7 are built first with *provisional inline shader strings* glued by a
stub `concatShaders()`; G1 later replaces that glue with the single WGSL
linker described here. The provisional inline shaders ship before G1
exists by design — G1 centralises them once there is something to link.

**Exit criterion.**

```bash
npm test -- --run test/integration/shader_compose
```

The simulate, reduce, and render pipelines all produce valid WGSL
modules that pass `device.createShaderModule` without warnings on
Chrome's WebGPU implementation. A symbol used but not defined produces a
loud error at link time, with line/file context, before reaching the
GPU.

## File tree

```
principia/
  src/
    gpu/
      wgsl/
        link.ts                 # the linker
        parse_imports.ts        # @import directive parser
        symbol_index.ts         # function/struct/const declaration index
        validate.ts             # symbol resolution check
        format_error.ts         # human-readable link errors
      shaders/
        helpers.wgsl            # @export everything that's reused
        decode.wgsl             # @import { mass_softmax } from helpers
        integrate.wgsl
        events.wgsl
        observe.wgsl
        metrics.wgsl
        simulate.wgsl
        reduce.wgsl
        render_layer0.wgsl
  test/
    unit/gpu/wgsl/
      parse_imports.test.ts
      symbol_index.test.ts
      validate.test.ts
      link.test.ts
    integration/
      shader_compose.test.ts
```

## Import directive syntax

A line-comment that starts with `// @import` declares cross-file
dependencies. Three forms:

```wgsl
// @import { mass_softmax, sigmoid } from "./helpers.wgsl"
// @import * as helpers from "./helpers.wgsl"
// @import "./helpers.wgsl"               // brings in everything @export'ed
```

`@export` marks a top-level symbol as importable. Anything not exported
is module-private. The convention matches ES modules deliberately; it
keeps mental model overhead low.

```wgsl
// @export
fn mass_softmax(z1: f32, z2: f32, mu_max: f32) -> vec3<f32> { ... }

// @export
struct State { /* ... */ }
```

## `src/gpu/wgsl/parse_imports.ts`

```ts
export interface ImportDirective {
  kind:    'named' | 'namespace' | 'side-effect';
  symbols?: string[];          // for named imports
  alias?:   string;            // for namespace imports
  fromPath: string;
  /** Source line in the importing file (1-based). */
  line:     number;
}

export interface ExportDirective {
  /** Symbol name (function, struct, const). */
  symbol: string;
  /** Source line in the defining file. */
  line:   number;
}

const RE_IMPORT_NAMED =
  /^\s*\/\/\s*@import\s*\{\s*([^}]+?)\s*\}\s*from\s*"([^"]+)"\s*$/;
const RE_IMPORT_NS =
  /^\s*\/\/\s*@import\s*\*\s*as\s+(\w+)\s+from\s*"([^"]+)"\s*$/;
const RE_IMPORT_SIDE =
  /^\s*\/\/\s*@import\s*"([^"]+)"\s*$/;
const RE_EXPORT =
  /^\s*\/\/\s*@export\s*$/;
const RE_DECL =
  /^\s*(?:fn|struct|const)\s+([A-Za-z_][A-Za-z0-9_]*)/;

/**
 * Parse a WGSL file's import / export directives. Returns the list of
 * imports and the set of symbols this file exports.
 */
export function parseDirectives(src: string): {
  imports: ImportDirective[];
  exports: ExportDirective[];
} {
  const lines = src.split('\n');
  const imports: ImportDirective[] = [];
  const exports: ExportDirective[] = [];
  let pendingExport = false;

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    let m: RegExpMatchArray | null;
    if ((m = ln.match(RE_IMPORT_NAMED))) {
      imports.push({
        kind: 'named',
        symbols: m[1]!.split(',').map(s => s.trim()).filter(Boolean),
        fromPath: m[2]!,
        line: i + 1,
      });
      continue;
    }
    if ((m = ln.match(RE_IMPORT_NS))) {
      imports.push({ kind: 'namespace', alias: m[1], fromPath: m[2]!, line: i + 1 });
      continue;
    }
    if ((m = ln.match(RE_IMPORT_SIDE))) {
      imports.push({ kind: 'side-effect', fromPath: m[1]!, line: i + 1 });
      continue;
    }
    if (RE_EXPORT.test(ln)) {
      pendingExport = true;
      continue;
    }
    if (pendingExport && (m = ln.match(RE_DECL))) {
      exports.push({ symbol: m[1]!, line: i + 1 });
      pendingExport = false;
      continue;
    }
    // Reset pending export on non-decl, non-blank, non-comment.
    if (pendingExport && ln.trim() !== '' && !ln.trim().startsWith('//')) {
      pendingExport = false;
    }
  }
  return { imports, exports };
}
```

## `src/gpu/wgsl/symbol_index.ts`

```ts
import type { ExportDirective, ImportDirective } from './parse_imports.js';

export interface ShaderUnit {
  path:    string;
  source:  string;
  imports: ImportDirective[];
  exports: ExportDirective[];
}

/**
 * Build a path → unit map. Caller supplies unit reads (the set of WGSL
 * files indexed by path); the linker accepts any IO mechanism.
 */
export function indexUnits(units: ShaderUnit[]): Map<string, ShaderUnit> {
  const out = new Map<string, ShaderUnit>();
  for (const u of units) {
    if (out.has(u.path)) {
      throw new Error(`duplicate shader unit path: ${u.path}`);
    }
    out.set(u.path, u);
  }
  return out;
}

/** Resolve a path relative to the importing file. We accept "./foo.wgsl"
 *  and "foo.wgsl"; both reference the same logical name. */
export function resolveImport(fromPath: string, importPath: string): string {
  if (importPath.startsWith('./')) importPath = importPath.slice(2);
  // We don't allow "../" — all shaders live under one directory.
  if (importPath.includes('/')) {
    throw new Error(`nested paths not supported in @import: ${importPath}`);
  }
  return importPath;
}
```

## `src/gpu/wgsl/validate.ts`

```ts
import type { ShaderUnit } from './symbol_index.js';
import { resolveImport } from './symbol_index.js';

export interface LinkError {
  unit:    string;
  line:    number;
  message: string;
}

/** Validate that every named import points at a real export, and that
 *  there are no circular import chains. */
export function validateImports(
  units: Map<string, ShaderUnit>,
): LinkError[] {
  const errors: LinkError[] = [];

  for (const [path, u] of units) {
    for (const imp of u.imports) {
      const targetPath = resolveImport(path, imp.fromPath);
      const target = units.get(targetPath);
      if (!target) {
        errors.push({
          unit: path, line: imp.line,
          message: `import target "${imp.fromPath}" not found in shader index`,
        });
        continue;
      }
      if (imp.kind === 'named') {
        const exported = new Set(target.exports.map(e => e.symbol));
        for (const sym of imp.symbols ?? []) {
          if (!exported.has(sym)) {
            errors.push({
              unit: path, line: imp.line,
              message: `import "${sym}" not @export'ed by ${targetPath}`,
            });
          }
        }
      }
    }
  }

  // Cycle detection (DFS).
  const colour = new Map<string, 'white' | 'grey' | 'black'>();
  for (const k of units.keys()) colour.set(k, 'white');
  const stack: string[] = [];
  const visit = (p: string): void => {
    if (colour.get(p) === 'black') return;
    if (colour.get(p) === 'grey') {
      errors.push({
        unit: p, line: 1,
        message: `circular import chain: ${stack.concat(p).join(' → ')}`,
      });
      return;
    }
    colour.set(p, 'grey');
    stack.push(p);
    const u = units.get(p)!;
    for (const imp of u.imports) {
      visit(resolveImport(p, imp.fromPath));
    }
    stack.pop();
    colour.set(p, 'black');
  };
  for (const k of units.keys()) visit(k);

  return errors;
}
```

## `src/gpu/wgsl/link.ts`

```ts
import type { ShaderUnit } from './symbol_index.js';
import { parseDirectives } from './parse_imports.js';
import { indexUnits, resolveImport } from './symbol_index.js';
import { validateImports } from './validate.js';

export interface LinkInput {
  /** The entry-point file. */
  entryPath: string;
  /** The set of all WGSL files (path → source). */
  sources:   Record<string, string>;
}

export interface LinkOutput {
  module: string;        // assembled WGSL
  units:  string[];      // paths included in the module, in topo order
}

/**
 * Resolve all imports starting from `entryPath`, topologically sort,
 * concatenate. Strips `// @import` and `// @export` directives from the
 * output. The result is one valid WGSL module ready for
 * `device.createShaderModule`.
 */
export function wgslLink(input: LinkInput): LinkOutput {
  // 1. Parse all units we might need (we'll prune below).
  const allUnits: ShaderUnit[] = [];
  for (const [path, source] of Object.entries(input.sources)) {
    const { imports, exports } = parseDirectives(source);
    allUnits.push({ path, source, imports, exports });
  }
  const index = indexUnits(allUnits);

  // 2. Validate imports first; bail with a useful message on any error.
  const errors = validateImports(index);
  if (errors.length > 0) {
    throw new Error(formatLinkErrors(errors));
  }

  // 3. Reachability from entry.
  const reachable = new Set<string>();
  const enqueue: string[] = [input.entryPath];
  while (enqueue.length > 0) {
    const p = enqueue.pop()!;
    if (reachable.has(p)) continue;
    reachable.add(p);
    const u = index.get(p);
    if (!u) throw new Error(`entry "${p}" not found in shader index`);
    for (const imp of u.imports) {
      enqueue.push(resolveImport(p, imp.fromPath));
    }
  }

  // 4. Topological order: dependencies before dependents.
  const ordered: string[] = [];
  const seen = new Set<string>();
  const visit = (p: string) => {
    if (seen.has(p)) return;
    seen.add(p);
    const u = index.get(p)!;
    for (const imp of u.imports) {
      visit(resolveImport(p, imp.fromPath));
    }
    ordered.push(p);
  };
  for (const p of reachable) visit(p);

  // 5. Concatenate, stripping directive comments.
  const parts: string[] = [];
  for (const p of ordered) {
    const u = index.get(p)!;
    parts.push(`// ===== unit: ${p} =====`);
    parts.push(stripDirectives(u.source));
    parts.push('');
  }
  return { module: parts.join('\n'), units: ordered };
}

function stripDirectives(src: string): string {
  return src
    .split('\n')
    .filter(l =>
      !/^\s*\/\/\s*@(import|export)\b/.test(l)
    ).join('\n');
}

function formatLinkErrors(errors: { unit: string; line: number; message: string }[]): string {
  return [
    'WGSL link errors:',
    ...errors.map(e => `  ${e.unit}:${e.line}: ${e.message}`),
  ].join('\n');
}
```

## `src/gpu/wgsl/format_error.ts`

```ts
import type { LinkError } from './validate.js';

/** Render a LinkError list as a multi-line string suitable for console
 *  / test failure output. */
export function formatErrors(errors: LinkError[]): string {
  if (errors.length === 0) return '';
  return errors.map(e => `${e.unit}:${e.line}: ${e.message}`).join('\n');
}

/** Render a snippet of source around the offending line for nicer
 *  diagnostics. */
export function snippetAt(source: string, line: number, ctx = 2): string {
  const lines = source.split('\n');
  const lo = Math.max(0, line - 1 - ctx);
  const hi = Math.min(lines.length, line + ctx);
  const out: string[] = [];
  for (let i = lo; i < hi; i++) {
    const marker = (i + 1 === line) ? '>' : ' ';
    out.push(`${marker} ${(i + 1).toString().padStart(4)}  ${lines[i]}`);
  }
  return out.join('\n');
}
```

## How M3 / M5 / M6 / M7 shaders look after G1

### `helpers.wgsl`

```wgsl
// @export
fn sigmoid(z: f32) -> f32 {
  if (z >= 0.0) { return 1.0 / (1.0 + exp(-z)); }
  let e = exp(z);  return e / (1.0 + e);
}

// @export
fn mass_softmax(z1: f32, z2: f32, mu_max: f32) -> vec3<f32> {
  // ...
}

// @export
fn rotJ(v: vec2<f32>) -> vec2<f32> { return vec2<f32>(-v.y, v.x); }
```

### `decode.wgsl`

```wgsl
// @import { mass_softmax, sigmoid } from "./helpers.wgsl"

// @export
struct ConfigDecoded { /* ... */ }

// @export
fn decode_full(z: array<f32, 8>, knobs: SimUniforms) -> ICOut { /* ... */ }
```

### `simulate.wgsl`

```wgsl
// @import { decode_full }                      from "./decode.wgsl"
// @import { kdk_macro_step, project_com }      from "./integrate.wgsl"
// @import { collision_check, escape_tick }     from "./events.wgsl"
// @import { shape_sphere }                     from "./metrics.wgsl"

@group(0) @binding(0) var<uniform> uniforms : SimUniforms;
// ...
@compute @workgroup_size(8, 8, 1)
fn simulate(@builtin(global_invocation_id) gid : vec3<u32>) { /* ... */ }
```

The build glue in M3's `dispatch_layer0.ts` becomes:

```ts
import { wgslLink } from '@/gpu/wgsl/link.js';
import helpersSrc   from './shaders/helpers.wgsl?raw';
import decodeSrc    from './shaders/decode.wgsl?raw';
import integrateSrc from './shaders/integrate.wgsl?raw';
import eventsSrc    from './shaders/events.wgsl?raw';
import metricsSrc   from './shaders/metrics.wgsl?raw';
import simulateSrc  from './shaders/simulate.wgsl?raw';

const linked = wgslLink({
  entryPath: 'simulate.wgsl',
  sources: {
    'helpers.wgsl':   helpersSrc,
    'decode.wgsl':    decodeSrc,
    'integrate.wgsl': integrateSrc,
    'events.wgsl':    eventsSrc,
    'metrics.wgsl':   metricsSrc,
    'simulate.wgsl':  simulateSrc,
  },
});
const module = device.createShaderModule({ code: linked.module });
```

(Vite / esbuild / equivalent supplies `?raw` import as the file's text.)

## Tests

### `test/unit/gpu/wgsl/parse_imports.test.ts`

```ts
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

  it('ignores @export when followed by a non-decl line', () => {
    const src = `// @export\n// stray comment\nfn nothing() {}`;
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
    expect(d.exports.map(e => e.symbol)).toEqual(['public_one', 'PublicStruct']);
  });
});
```

### `test/unit/gpu/wgsl/symbol_index.test.ts`

```ts
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
    ])).toThrow();
  });
});
```

### `test/unit/gpu/wgsl/validate.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { validateImports } from '@/gpu/wgsl/validate.js';
import { parseDirectives } from '@/gpu/wgsl/parse_imports.js';

function unit(path: string, src: string) {
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
  });

  it('reports an unexported symbol', () => {
    const units = new Map([
      ['a.wgsl', unit('a.wgsl', `fn private() {}`)],
      ['b.wgsl', unit('b.wgsl',
        `// @import { private } from "./a.wgsl"\nfn entry() {}`)],
    ]);
    const errs = validateImports(units);
    expect(errs[0]!.message).toContain('not @export');
  });

  it('reports a cycle', () => {
    const units = new Map([
      ['a.wgsl', unit('a.wgsl',
        `// @import { from_b } from "./b.wgsl"\n// @export\nfn from_a() {}`)],
      ['b.wgsl', unit('b.wgsl',
        `// @import { from_a } from "./a.wgsl"\n// @export\nfn from_b() {}`)],
    ]);
    const errs = validateImports(units);
    expect(errs.some(e => e.message.includes('circular'))).toBe(true);
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
});
```

### `test/unit/gpu/wgsl/link.test.ts`

```ts
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
        'a.wgsl':       `fn entry() {}`,
        'unused.wgsl':  `fn unused() {}`,
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
});
```

### `test/integration/shader_compose.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { wgslLink } from '@/gpu/wgsl/link.js';

/**
 * Realistic mini-suite: helpers + decode + simulate. Compose them and
 * (when WebGPU is present) feed the result to `createShaderModule`.
 */
describe('shader compose end-to-end', () => {
  const sources = {
    'helpers.wgsl': [
      '// @export',
      'fn sigmoid(z: f32) -> f32 {',
      '  return 1.0 / (1.0 + exp(-z));',
      '}',
      '// @export',
      'const PI: f32 = 3.141592653589793;',
    ].join('\n'),
    'decode.wgsl': [
      '// @import { sigmoid, PI } from "./helpers.wgsl"',
      '// @export',
      'fn decode_one(z: f32) -> f32 {',
      '  return sigmoid(z) * PI;',
      '}',
    ].join('\n'),
    'main.wgsl': [
      '// @import { decode_one } from "./decode.wgsl"',
      '@compute @workgroup_size(1)',
      'fn simulate(@builtin(global_invocation_id) gid: vec3<u32>) {',
      '  let _ = decode_one(0.0);',
      '}',
    ].join('\n'),
  };

  it('produces a topologically-ordered, directive-free module', () => {
    const out = wgslLink({ entryPath: 'main.wgsl', sources });
    expect(out.units).toEqual(['helpers.wgsl', 'decode.wgsl', 'main.wgsl']);
    expect(out.module).not.toContain('@import');
    expect(out.module).toContain('fn sigmoid');
    expect(out.module).toContain('fn decode_one');
    expect(out.module).toContain('@compute');
  });

  it('createShaderModule accepts the linked output (skip if no WebGPU)', async () => {
    if (!('gpu' in (globalThis as any).navigator ?? {})) return;
    const adapter = await (navigator as any).gpu.requestAdapter();
    const device = await adapter!.requestDevice();
    const out = wgslLink({ entryPath: 'main.wgsl', sources });
    const module = device.createShaderModule({ code: out.module });
    const info = await (module as any).getCompilationInfo?.();
    if (info) {
      expect(info.messages.filter((m: any) => m.type === 'error'))
        .toHaveLength(0);
    }
  });
});
```

## Run it

```bash
npm test -- --run test/unit/gpu/wgsl
npm test -- --run test/integration/shader_compose
```

## Acceptance check

```bash
npm test -- --run test/integration/shader_compose
```

Linker produces topologically-ordered, directive-free WGSL. Cycles and
unresolved symbols fail loudly at link time, not silently at GPU compile
time.

## Notes for the implementer

- **One-directory-only rule.** `resolveImport` rejects `..` and `/`; all
  shaders live in `src/gpu/shaders/`. Keeps the linker tiny and the
  module graph easy to reason about.
- **Bundler integration.** The Vite / esbuild glue uses `?raw` imports
  to read each `.wgsl` file as text at build time. The linker doesn't
  read from disk — it just consumes `Record<path, source>`. This keeps
  it testable and lets you swap in a different IO mechanism (e.g.
  hot-reload from a watcher).
- **Future room.** The directive grammar is deliberately restrictive
  (matches ES modules at the syntactic level). If you ever need
  conditional compilation or per-tier specialisation, the natural
  extension is to add `// @if FTLE_ENABLED` / `// @endif` blocks; the
  parser is small enough that this is a 30-line addition.
- **No re-exports.** A unit can't `// @export { foo }` something it
  imported. If you need that, write a wrapper function. Keeping the
  rule means `validateImports` is local; otherwise it has to do
  fixed-point analysis.
- **Compilation info.** Browsers expose `module.getCompilationInfo()`
  for shader warnings; the integration test above uses it when
  available. CI pipelines that run a real headless Chrome can flag
  warnings as test failures.
