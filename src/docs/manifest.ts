/**
 * Declarative requirements for the docs site (G16). Pure data + tiny helpers;
 * no I/O here — completeness.ts does the checking and the test does the
 * filesystem reads. Keeping the requirement set declarative means the checker,
 * the tests, and a future docs linter all agree on one source.
 */

/** Paths are POSIX-relative to the docs/ directory. */
export interface DocsManifest {
  /** The index/hub every other page must be reachable from. */
  index: string;
  /** Pages that must exist AND be linked from the index. */
  requiredPages: readonly string[];
  /** The ADR index page that must link every docs/adr/NNNN-*.md. */
  adrIndexPage: string;
  /** The glossary page that must define every term below. */
  glossaryPage: string;
  /** Terms that must appear as a heading with a non-empty definition. */
  glossaryTerms: readonly string[];
}

export const DOCS_MANIFEST: DocsManifest = {
  index: 'README.md',
  requiredPages: [
    'user-guide.md',
    'architecture.md',
    'adr-index.md',
    'glossary.md',
    'runbooks/add-a-chart.md',
  ],
  adrIndexPage: 'adr-index.md',
  glossaryPage: 'glossary.md',
  glossaryTerms: [
    'Jacobi coordinates',
    'Shape sphere',
    'Broucke–Hénon / Euler / Lagrange',
    'Free-group word',
    'FTLE',
    'Diffusion',
    'Coherence score',
    'Ensemble spread',
    'Quality tiers',
    'Two-stage pipeline',
    'Chart contract',
  ],
} as const;

/** Filesystem locations the checker reads to derive "what must be covered". */
export interface DocsLayout {
  /** Absolute path to the repo root. */
  repoRoot: string;
  /** Relative to repoRoot. */
  docsDir: string;
  milestonesIndex: string;
  adrDir: string;
}

export const DEFAULT_LAYOUT: Omit<DocsLayout, 'repoRoot'> = {
  docsDir: 'docs',
  milestonesIndex: 'milestones/README.md',
  adrDir: 'docs/adr',
} as const;

/** Normalise a heading/term for tolerant comparison (case + whitespace). */
export function normaliseTerm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}
