import { normaliseTerm } from './manifest.js';

/**
 * Pure docs-completeness/link checker (G16). Every function takes its inputs
 * explicitly (file contents, file lists, an exists predicate) so the unit
 * suite drives it without touching the real filesystem beyond a thin loader.
 * The Markdown link parser is deliberately small — it matches inline
 * `[text](target)` links; images are excluded and code (fenced + inline) is
 * stripped first so a link inside an example never counts.
 */

/** A parsed inline Markdown link. */
export interface MdLink {
  text: string;
  /** Raw target as written, e.g. './glossary.md#ftle' or 'https://…'. */
  target: string;
}

/** A single check result. `ok:false` carries a human-readable reason. */
export type Check =
  | { ok: true; what: string }
  | { ok: false; what: string; detail: string };

const CODE_FENCE = /```[\s\S]*?```/g;
const CODE_SPAN = /`[^`]*`/g;
const LINK = /(?<!!)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** Strip fenced + inline code so example links inside code never count. */
export function stripCode(md: string): string {
  return md.replace(CODE_FENCE, '').replace(CODE_SPAN, '');
}

/** Parse inline links from Markdown, ignoring images and code. */
export function parseLinks(md: string): MdLink[] {
  const clean = stripCode(md);
  const out: MdLink[] = [];
  for (const m of clean.matchAll(LINK)) {
    out.push({ text: m[1] ?? '', target: m[2] ?? '' });
  }
  return out;
}

/** True for a link target that points outside the docs tree (skip resolution). */
export function isExternal(target: string): boolean {
  return /^[a-z]+:/i.test(target) || target.startsWith('//') || target.startsWith('#');
}

/** Strip a trailing #anchor and any ?query from a relative target. */
export function stripAnchor(target: string): string {
  const hash = target.indexOf('#');
  const q = target.indexOf('?');
  let end = target.length;
  if (hash >= 0) end = Math.min(end, hash);
  if (q >= 0) end = Math.min(end, q);
  return target.slice(0, end);
}

/** Targets of the relative links found in `md`, anchors stripped, externals dropped. */
export function relativeLinkTargets(md: string): string[] {
  return parseLinks(md)
    .map((l) => l.target)
    .filter((t) => !isExternal(t))
    .map(stripAnchor)
    .filter((t) => t.length > 0);
}

/**
 * Does the index link each required page? A direct link is required — a flat
 * hub, so the index is genuinely a table of contents.
 */
export function checkIndexLinksPages(
  indexMd: string,
  requiredPages: readonly string[],
): Check[] {
  const linked = new Set(relativeLinkTargets(indexMd).map((t) => t.replace(/^\.\//, '')));
  return requiredPages.map<Check>((page) =>
    linked.has(page)
      ? { ok: true, what: `index links ${page}` }
      : {
          ok: false, what: `index links ${page}`,
          detail: `no relative link to "${page}" in the docs index`,
        },
  );
}

/**
 * Does the docs index link every milestone listed in milestones/README.md?
 * `milestoneFiles` is the set of filenames the milestone index references
 * (e.g. 'G16_documentation_onboarding.md'); a docs index link to
 * '../milestones/<file>' satisfies coverage.
 */
export function checkMilestoneCoverage(
  indexMd: string,
  milestoneFiles: readonly string[],
): Check[] {
  const linked = relativeLinkTargets(indexMd).map((t) => t.split('/').pop() ?? t);
  const linkedSet = new Set(linked);
  return milestoneFiles.map<Check>((file) =>
    linkedSet.has(file)
      ? { ok: true, what: `index covers milestone ${file}` }
      : {
          ok: false, what: `index covers milestone ${file}`,
          detail: `docs index does not link milestone "${file}"`,
        },
  );
}

/** Does the ADR index page link every docs/adr/NNNN-*.md? */
export function checkAdrCoverage(
  adrIndexMd: string,
  adrFiles: readonly string[],
): Check[] {
  const linked = new Set(
    relativeLinkTargets(adrIndexMd).map((t) => t.split('/').pop() ?? t));
  return adrFiles.map<Check>((file) =>
    linked.has(file)
      ? { ok: true, what: `ADR index links ${file}` }
      : {
          ok: false, what: `ADR index links ${file}`,
          detail: `adr-index.md does not link "${file}"`,
        },
  );
}

/**
 * Every glossary term must appear as a heading and be followed by non-empty
 * prose. Headings are matched at any level ≥2; the body is the text up to the
 * next heading. Comparison is tolerant (case + whitespace).
 */
export function checkGlossaryTerms(
  glossaryMd: string,
  terms: readonly string[],
): Check[] {
  const sections = parseHeadingSections(glossaryMd);
  const byTerm = new Map(sections.map((s) => [normaliseTerm(s.heading), s.body]));
  return terms.map<Check>((term) => {
    const body = byTerm.get(normaliseTerm(term));
    if (body === undefined) {
      return {
        ok: false, what: `glossary defines "${term}"`,
        detail: `no heading matching "${term}"`,
      };
    }
    if (body.trim().length === 0) {
      return {
        ok: false, what: `glossary defines "${term}"`,
        detail: `heading "${term}" has an empty definition`,
      };
    }
    return { ok: true, what: `glossary defines "${term}"` };
  });
}

export interface HeadingSection { heading: string; body: string }

/** Split Markdown into (heading, body-until-next-heading) sections. */
export function parseHeadingSections(md: string): HeadingSection[] {
  const lines = stripCode(md).split('\n');
  const sections: HeadingSection[] = [];
  let cur: HeadingSection | null = null;
  const headingRe = /^#{2,6}\s+(.*?)\s*#*\s*$/;
  for (const line of lines) {
    const m = headingRe.exec(line);
    if (m) {
      if (cur) sections.push(cur);
      cur = { heading: m[1] ?? '', body: '' };
    } else if (cur) {
      cur.body += `${line}\n`;
    }
  }
  if (cur) sections.push(cur);
  return sections;
}

/**
 * Resolve every relative link in `pages` against the filesystem.
 * `pages` maps a doc's POSIX path (relative to docsDir) to its content;
 * `exists(resolved)` reports whether the resolved path is a real file. A
 * resolved path is relative to docsDir, EXCEPT that leading '..' segments
 * (links that escape docsDir, e.g. '../milestones/*.md' or '../CLAUDE.md')
 * are preserved by posixResolve — so `exists` must resolve against docsDir
 * with a join() that walks up for leading '..' (node's join does).
 */
export function checkRelativeLinks(
  pages: ReadonlyMap<string, string>,
  exists: (resolved: string) => boolean,
): Check[] {
  const out: Check[] = [];
  for (const [page, content] of pages) {
    const baseDir = posixDirname(page);
    for (const target of relativeLinkTargets(content)) {
      const resolved = posixResolve(baseDir, target);
      out.push(
        exists(resolved)
          ? { ok: true, what: `${page} → ${target}` }
          : {
              ok: false, what: `${page} → ${target}`,
              detail: `broken link: resolves to "${resolved}", not found`,
            },
      );
    }
  }
  return out;
}

/** POSIX dirname for a relative path ('a/b.md' → 'a'; 'b.md' → ''). */
export function posixDirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

/**
 * Resolve `target` against `baseDir`, collapsing '.' and '..'. Leading '..'
 * segments that escape the base are PRESERVED (posixResolve('', '../x') →
 * '../x'), so a doc link that points above docsDir resolves correctly against
 * the repo root rather than silently no-opping. The caller's `exists`
 * predicate must therefore root at docsDir and let join() walk up.
 */
export function posixResolve(baseDir: string, target: string): string {
  const parts = (baseDir ? baseDir.split('/') : []).concat(target.split('/'));
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      // Pop a real segment, but keep a leading '..' that escapes the base.
      if (stack.length > 0 && stack[stack.length - 1] !== '..') stack.pop();
      else stack.push('..');
      continue;
    }
    stack.push(part);
  }
  return stack.join('/');
}

/** Convenience: are all checks ok? */
export function allOk(checks: readonly Check[]): boolean {
  return checks.every((c) => c.ok);
}

/** Pretty failures for a CLI/CI summary. */
export function failures(checks: readonly Check[]): string[] {
  return checks
    .filter((c): c is Extract<Check, { ok: false }> => !c.ok)
    .map((c) => `✗ ${c.what}: ${c.detail}`);
}
