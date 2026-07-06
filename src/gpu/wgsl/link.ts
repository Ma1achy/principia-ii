import type { ShaderUnit } from './symbol_index.js';
import { parseDirectives } from './parse_imports.js';
import { indexUnits, resolveImport } from './symbol_index.js';
import { validateImports } from './validate.js';
import { formatErrors } from './format_error.js';

export interface LinkInput {
  /** The entry-point file. */
  entryPath: string;
  /** The set of all WGSL files (path → source). */
  sources: Record<string, string>;
}

export interface LinkOutput {
  /** Assembled WGSL, directives stripped. */
  module: string;
  /** Paths included in the module, dependencies before dependents. */
  units: string[];
}

/**
 * Resolve all imports starting from `entryPath`, topologically sort,
 * concatenate. Strips `// @import` and `// @export` directives from the
 * output. The result is one valid WGSL module ready for
 * `device.createShaderModule`.
 *
 * The linker does no IO — callers supply `Record<path, source>` (dev pages
 * use Vite `?raw` imports; tests read from disk with node:fs).
 */
export function wgslLink(input: LinkInput): LinkOutput {
  // 1. Parse every supplied unit (reachability prunes below).
  const allUnits: ShaderUnit[] = [];
  for (const [path, source] of Object.entries(input.sources)) {
    const { imports, exports } = parseDirectives(source);
    allUnits.push({ path, source, imports, exports });
  }
  const index = indexUnits(allUnits);

  if (!index.has(input.entryPath)) {
    throw new Error(`entry "${input.entryPath}" not found in shader index`);
  }

  // 2. Validate imports first; bail with a useful message on any error.
  const errors = validateImports(index);
  if (errors.length > 0) {
    throw new Error(`WGSL link errors:\n${formatErrors(errors)}`);
  }

  // 3+4. Topological order over the units reachable from the entry:
  // dependencies before dependents, following directive order (validation
  // guarantees the graph is acyclic and every target resolves).
  const ordered: string[] = [];
  const seen = new Set<string>();
  const visit = (p: string): void => {
    if (seen.has(p)) return;
    seen.add(p);
    const u = index.get(p)!;
    for (const imp of u.imports) {
      visit(resolveImport(p, imp.fromPath));
    }
    ordered.push(p);
  };
  visit(input.entryPath);

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

/** Remove `// @import` / `// @export` directive lines from a unit source. */
export function stripDirectives(src: string): string {
  return src
    .split('\n')
    .filter((l) => !/^\s*\/\/\s*@(import|export)\b/.test(l))
    .join('\n');
}
