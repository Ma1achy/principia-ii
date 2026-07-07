/**
 * Canonical WGSL module list for the build (G15). G1 has no registry:
 * `wgslLink` (@/gpu/wgsl/link.js) is a per-entry linker fed an explicit
 * sources map from `?raw` imports (dev/shader_modules.ts). This list is the
 * build's own source of truth; the build_config validator asserts BOTH
 * directions — every entry resolves to a file under src/gpu/shaders/, and
 * every *.wgsl file on disk appears here — so the manifest can never drift
 * from the real shader set.
 *
 * Order is irrelevant to linking (wgslLink resolves imports by graph), but
 * kept alphabetical so diffs are stable.
 */
export const SHADER_DIR = 'src/gpu/shaders';

/** File names only (no directory). Joined with SHADER_DIR to resolve on disk. */
export const SHADER_MODULES = [
  'brightness_modes.wgsl',
  'colour_modes.wgsl',
  'combiner.wgsl',
  'cvd.wgsl',
  'decode.wgsl',
  'decode_linear.wgsl',
  'events.wgsl',
  'free_group.wgsl',
  'helpers.wgsl',
  'integrate.wgsl',
  'metrics.wgsl',
  'observe.wgsl',
  'reduce.wgsl',
  'render_graph.wgsl',
  'render_helpers.wgsl',
  'render_layer0.wgsl',
  'simulate.wgsl',
] as const;

export type ShaderModule = (typeof SHADER_MODULES)[number];

/** POSIX-joined repo-relative path for a module (used by the validator). */
export function shaderPath(mod: ShaderModule): string {
  return `${SHADER_DIR}/${mod}`;
}

/** All shader paths, repo-relative. */
export function allShaderPaths(): string[] {
  return SHADER_MODULES.map(shaderPath);
}
