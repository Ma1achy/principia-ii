/**
 * `@import` / `@export` directive parser (G1).
 *
 * Directives are WGSL line comments, so an annotated file is still a valid
 * standalone WGSL fragment. Three import forms (mirroring ES modules):
 *
 *   // @import { mass_softmax, sigmoid } from "./helpers.wgsl"
 *   // @import * as helpers from "./helpers.wgsl"
 *   // @import "./helpers.wgsl"
 *
 * `@export` marks the next `fn` / `struct` / `const` declaration as
 * importable. Plain comments and blank lines between `@export` and the
 * declaration are allowed (doc comments are desirable there); any other
 * code cancels the pending export.
 *
 * Note the namespace form is a documentation-only alias: WGSL has no
 * namespaces, so `h.sigmoid(x)` will not compile — imported symbols are
 * always referenced by their bare exported name.
 */

export interface ImportDirective {
  kind: 'named' | 'namespace' | 'side-effect';
  symbols?: string[]; // for named imports
  alias?: string; // for namespace imports
  fromPath: string;
  /** Source line of the directive in the importing file (1-based). */
  line: number;
}

export interface ExportDirective {
  /** Symbol name (function, struct, const). */
  symbol: string;
  /** Source line of the declaration in the defining file (1-based). */
  line: number;
}

const RE_IMPORT_NAMED =
  /^\s*\/\/\s*@import\s*\{\s*([^}]+?)\s*\}\s*from\s*"([^"]+)"\s*$/;
const RE_IMPORT_NS = /^\s*\/\/\s*@import\s*\*\s*as\s+(\w+)\s+from\s*"([^"]+)"\s*$/;
const RE_IMPORT_SIDE = /^\s*\/\/\s*@import\s*"([^"]+)"\s*$/;
const RE_EXPORT = /^\s*\/\/\s*@export\s*$/;
const RE_DECL = /^\s*(?:fn|struct|const)\s+([A-Za-z_][A-Za-z0-9_]*)/;

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
        symbols: m[1]!.split(',').map((s) => s.trim()).filter(Boolean),
        fromPath: m[2]!,
        line: i + 1,
      });
      continue;
    }
    if ((m = ln.match(RE_IMPORT_NS))) {
      imports.push({ kind: 'namespace', alias: m[1]!, fromPath: m[2]!, line: i + 1 });
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
    // Comments and blank lines keep a pending @export alive; any other
    // non-declaration code cancels it.
    if (pendingExport && ln.trim() !== '' && !ln.trim().startsWith('//')) {
      pendingExport = false;
    }
  }
  return { imports, exports };
}
