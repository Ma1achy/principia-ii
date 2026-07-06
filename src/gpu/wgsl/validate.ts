import type { ShaderUnit } from './symbol_index.js';
import { resolveImport } from './symbol_index.js';

export interface LinkError {
  unit: string;
  line: number;
  message: string;
}

/**
 * Validate that every import target exists, that every named import points
 * at a real export, and that there are no circular import chains.
 *
 * Scope (deliberate): this checks *declared imports only* — it does not do
 * symbol-use analysis of the WGSL body. Entry-owned structs (SimUniforms,
 * TileRequest, SimResult, ICDescriptor) are referenced by imported units
 * without an @import; WGSL module-scope forward references make that legal
 * in the concatenated output, and it is what keeps the unit graph acyclic.
 */
export function validateImports(units: Map<string, ShaderUnit>): LinkError[] {
  const errors: LinkError[] = [];

  for (const [path, u] of units) {
    for (const imp of u.imports) {
      let targetPath: string;
      try {
        targetPath = resolveImport(path, imp.fromPath);
      } catch (e) {
        errors.push({
          unit: path,
          line: imp.line,
          message: e instanceof Error ? e.message : String(e),
        });
        continue;
      }
      const target = units.get(targetPath);
      if (!target) {
        errors.push({
          unit: path,
          line: imp.line,
          message: `import target "${imp.fromPath}" not found in shader index`,
        });
        continue;
      }
      if (imp.kind === 'named') {
        const exported = new Set(target.exports.map((e) => e.symbol));
        for (const sym of imp.symbols ?? []) {
          if (!exported.has(sym)) {
            errors.push({
              unit: path,
              line: imp.line,
              message: `import "${sym}" not @export'ed by ${targetPath}`,
            });
          }
        }
      }
    }
  }

  // Cycle detection (DFS, three-colour). Unresolvable targets were already
  // reported above; the walk just skips them.
  const colour = new Map<string, 'white' | 'grey' | 'black'>();
  for (const k of units.keys()) colour.set(k, 'white');
  const stack: string[] = [];
  const visit = (p: string): void => {
    if (colour.get(p) === 'black') return;
    if (colour.get(p) === 'grey') {
      errors.push({
        unit: p,
        line: 1,
        message: `circular import chain: ${stack.concat(p).join(' -> ')}`,
      });
      return;
    }
    const u = units.get(p);
    if (!u) return;
    colour.set(p, 'grey');
    stack.push(p);
    for (const imp of u.imports) {
      let target: string;
      try {
        target = resolveImport(p, imp.fromPath);
      } catch {
        continue;
      }
      visit(target);
    }
    stack.pop();
    colour.set(p, 'black');
  };
  for (const k of units.keys()) visit(k);

  return errors;
}
