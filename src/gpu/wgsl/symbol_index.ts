import type { ExportDirective, ImportDirective } from './parse_imports.js';

export interface ShaderUnit {
  path: string;
  source: string;
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

/**
 * Resolve a path relative to the importing file. We accept "./foo.wgsl"
 * and "foo.wgsl"; both reference the same logical name. All linkable
 * shaders live flat in one directory, so `../` and nested paths are
 * rejected outright.
 */
export function resolveImport(fromPath: string, importPath: string): string {
  if (importPath.startsWith('./')) importPath = importPath.slice(2);
  if (importPath.includes('/')) {
    throw new Error(
      `nested paths not supported in @import (from ${fromPath}): ${importPath}`,
    );
  }
  return importPath;
}
