import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { wgslLink, stripDirectives } from '@/gpu/wgsl/link.js';

const SHADER_DIR = fileURLToPath(new URL('../../src/gpu/shaders/', import.meta.url));

/** Read every real shader unit as Record<path, source> (the linker does no IO). */
function readAllShaders(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(SHADER_DIR)) {
    if (f.endsWith('.wgsl')) out[f] = readFileSync(join(SHADER_DIR, f), 'utf8');
  }
  return out;
}

describe('shader compose end-to-end (synthetic mini-suite)', () => {
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
      '  let x = decode_one(0.0);',
      '}',
    ].join('\n'),
  };

  it('produces a topologically-ordered, directive-free module', () => {
    const out = wgslLink({ entryPath: 'main.wgsl', sources });
    expect(out.units).toEqual(['helpers.wgsl', 'decode.wgsl', 'main.wgsl']);
    expect(out.module).not.toContain('@import');
    expect(out.module).not.toContain('@export');
    expect(out.module).toContain('fn sigmoid');
    expect(out.module).toContain('fn decode_one');
    expect(out.module).toContain('@compute');
  });

  it('createShaderModule accepts the linked output (skip if no WebGPU)', async () => {
    const nav = (globalThis as { navigator?: { gpu?: unknown } }).navigator;
    if (!nav?.gpu) return;
    const gpu = nav.gpu as {
      requestAdapter(): Promise<{ requestDevice(): Promise<unknown> } | null>;
    };
    const adapter = await gpu.requestAdapter();
    if (!adapter) return;
    const device = (await adapter.requestDevice()) as {
      createShaderModule(desc: { code: string }): {
        getCompilationInfo?: () => Promise<{ messages: { type: string }[] }>;
      };
    };
    const out = wgslLink({ entryPath: 'main.wgsl', sources });
    const module = device.createShaderModule({ code: out.module });
    const info = await module.getCompilationInfo?.();
    if (info) {
      expect(info.messages.filter((m) => m.type === 'error')).toHaveLength(0);
    }
  });
});

describe('shader compose over the real Principia shaders', () => {
  const sources = readAllShaders();

  // Hand-maintained concat orders these replaced (dev/render_graph.ts et al.).
  const SIMULATE_UNITS = [
    'helpers.wgsl', 'observe.wgsl', 'events.wgsl',
    'integrate.wgsl', 'decode.wgsl', 'simulate.wgsl',
  ];
  const RENDER_UNITS = [
    'render_helpers.wgsl', 'colour_modes.wgsl', 'brightness_modes.wgsl',
    'combiner.wgsl', 'cvd.wgsl', 'render_graph.wgsl',
  ];

  it('links the simulate module from the real shader files', () => {
    const out = wgslLink({ entryPath: 'simulate.wgsl', sources });
    expect([...out.units].sort()).toEqual([...SIMULATE_UNITS].sort());
    expect(out.units.at(-1)).toBe('simulate.wgsl');
    expect(out.module).not.toContain('@import');
    expect(out.module).not.toContain('@export');
  });

  it('links the render module from the real shader files', () => {
    const out = wgslLink({ entryPath: 'render_graph.wgsl', sources });
    expect([...out.units].sort()).toEqual([...RENDER_UNITS].sort());
    expect(out.units.at(-1)).toBe('render_graph.wgsl');
    // render_helpers owns PI for the render family; the simulate-family
    // helpers.wgsl (with its duplicate PI) must never be pulled in.
    expect(out.units).not.toContain('helpers.wgsl');
  });

  it('linked simulate module is semantically the hand-concat: same units, verbatim bodies', () => {
    // Byte-equality with the M3 concat is impossible (the topo sort reorders
    // units); semantic equivalence for WGSL concatenation = same unit SET
    // (module-scope forward references make order irrelevant) with each
    // unit's directive-stripped source intact.
    const out = wgslLink({ entryPath: 'simulate.wgsl', sources });
    for (const u of SIMULATE_UNITS) {
      expect(out.module).toContain(stripDirectives(sources[u]!));
    }
  });

  it('linked render module carries every unit body verbatim', () => {
    const out = wgslLink({ entryPath: 'render_graph.wgsl', sources });
    for (const u of RENDER_UNITS) {
      expect(out.module).toContain(stripDirectives(sources[u]!));
    }
  });

  it('standalone entries (reduce, render_layer0) link as single-unit modules', () => {
    for (const entry of ['reduce.wgsl', 'render_layer0.wgsl']) {
      const out = wgslLink({ entryPath: entry, sources });
      expect(out.units).toEqual([entry]);
    }
  });

  it('every named import across the real shader set resolves (no dangling exports needed)', () => {
    // Linking each entry already validates the whole supplied set, but make
    // the failure mode explicit: link with every file supplied so a future
    // directive typo in ANY unit fails here, not at GPU compile time.
    expect(() => wgslLink({ entryPath: 'simulate.wgsl', sources })).not.toThrow();
    expect(() => wgslLink({ entryPath: 'render_graph.wgsl', sources })).not.toThrow();
    expect(() => wgslLink({ entryPath: 'metrics.wgsl', sources })).not.toThrow();
  });
});
