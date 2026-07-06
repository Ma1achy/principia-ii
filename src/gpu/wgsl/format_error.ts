import type { LinkError } from './validate.js';

/**
 * Render a LinkError list as a multi-line string suitable for console /
 * test failure output.
 */
export function formatErrors(errors: LinkError[]): string {
  if (errors.length === 0) return '';
  return errors.map((e) => `${e.unit}:${e.line}: ${e.message}`).join('\n');
}

/**
 * Render a snippet of source around the offending line (1-based) for
 * nicer diagnostics.
 */
export function snippetAt(source: string, line: number, ctx = 2): string {
  const lines = source.split('\n');
  const lo = Math.max(0, line - 1 - ctx);
  const hi = Math.min(lines.length, line + ctx);
  const out: string[] = [];
  for (let i = lo; i < hi; i++) {
    const marker = i + 1 === line ? '>' : ' ';
    out.push(`${marker} ${(i + 1).toString().padStart(4)}  ${lines[i]}`);
  }
  return out.join('\n');
}
