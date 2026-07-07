import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  parseLinks, isExternal, stripAnchor, relativeLinkTargets,
  posixDirname, posixResolve, parseHeadingSections,
  checkIndexLinksPages, checkMilestoneCoverage, checkAdrCoverage,
  checkGlossaryTerms, checkRelativeLinks, allOk, failures,
} from '@/docs/completeness.js';
import { DOCS_MANIFEST, DEFAULT_LAYOUT, normaliseTerm } from '@/docs/manifest.js';

/**
 * G16 exit suite. A thin filesystem loader reads the REAL docs (so the gate
 * verifies the shipped pages); every assertion then runs against parsed
 * content. Pure and headless — no GPU, no browser, no network.
 */

// Repo root = three levels up from test/unit/docs/.
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const docsDir = join(repoRoot, DEFAULT_LAYOUT.docsDir);

const readDoc = (relToDocs: string): string =>
  readFileSync(join(docsDir, relToDocs), 'utf8');
const existsInDocs = (relToDocs: string): boolean =>
  // join() walks up for leading '..', so links that escape docs/ (e.g.
  // '../milestones/*.md') resolve against the repo root as intended.
  existsSync(join(docsDir, relToDocs));

/** All markdown files under docs/ as POSIX paths relative to docsDir. */
function listDocPages(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (abs: string, rel: string): void => {
    for (const name of readdirSync(abs)) {
      if (name === 'api') continue; // generated (TypeDoc); not content-checked
      const childAbs = join(abs, name);
      const childRel = rel ? `${rel}/${name}` : name;
      if (statSync(childAbs).isDirectory()) walk(childAbs, childRel);
      else if (name.endsWith('.md')) out.set(childRel, readFileSync(childAbs, 'utf8'));
    }
  };
  walk(docsDir, '');
  return out;
}

/** Milestone filenames referenced by milestones/README.md. */
function milestoneFiles(): string[] {
  const md = readFileSync(join(repoRoot, DEFAULT_LAYOUT.milestonesIndex), 'utf8');
  const files = new Set<string>();
  for (const l of parseLinks(md)) {
    const t = stripAnchor(l.target);
    if (/^[MG]\d+_.*\.md$/.test(t)) files.add(t);
  }
  return [...files].sort();
}

/** ADR record files (docs/adr/NNNN-*.md), excluding the README. */
function adrFiles(): string[] {
  const adrAbs = join(repoRoot, DEFAULT_LAYOUT.adrDir);
  return readdirSync(adrAbs)
    .filter((n) => /^\d{4}-.*\.md$/.test(n))
    .sort();
}

describe('link parser (pure)', () => {
  it('extracts inline links and ignores images', () => {
    const links = parseLinks('see [a](a.md) and ![img](x.png) and [b](b.md#h)');
    expect(links.map((l) => l.target)).toEqual(['a.md', 'b.md#h']);
  });

  it('strips fenced and inline code so example links are not counted', () => {
    const md = 'real [x](x.md)\n```\n[fake](nope.md)\n```\ninline `[also](no.md)`';
    expect(relativeLinkTargets(md)).toEqual(['x.md']);
  });

  it('classifies external vs relative targets', () => {
    expect(isExternal('https://e.com')).toBe(true);
    expect(isExternal('#anchor')).toBe(true);
    expect(isExternal('mailto:a@b')).toBe(true);
    expect(isExternal('./rel.md')).toBe(false);
    expect(isExternal('../CLAUDE.md')).toBe(false);
  });

  it('strips anchors and queries from relative targets', () => {
    expect(stripAnchor('a/b.md#frag')).toBe('a/b.md');
    expect(stripAnchor('a.md?x=1')).toBe('a.md');
    expect(stripAnchor('a.md')).toBe('a.md');
  });
});

describe('path resolution (pure)', () => {
  it('resolves relative targets against a base dir, collapsing ..', () => {
    expect(posixResolve('runbooks', '../glossary.md')).toBe('glossary.md');
    expect(posixResolve('', './user-guide.md')).toBe('user-guide.md');
    expect(posixDirname('runbooks/add-a-chart.md')).toBe('runbooks');
    expect(posixDirname('README.md')).toBe('');
  });

  it('preserves leading .. that escape the base dir (links above docsDir)', () => {
    // From the index (baseDir ''), '../milestones/*.md' and '../CLAUDE.md'
    // must keep their leading '..' so exists() resolves them against the repo
    // root, not silently no-op down to 'milestones/*.md' / 'CLAUDE.md'.
    expect(posixResolve('', '../milestones/G16_documentation_onboarding.md'))
      .toBe('../milestones/G16_documentation_onboarding.md');
    expect(posixResolve('', '../CLAUDE.md')).toBe('../CLAUDE.md');
    // A '..' from a one-deep base cancels that segment, then escapes.
    expect(posixResolve('runbooks', '../../CLAUDE.md')).toBe('../CLAUDE.md');
  });
});

describe('heading sections + term normalisation (pure)', () => {
  it('splits headings into (heading, body) sections', () => {
    const s = parseHeadingSections('## A\nbody a\n## B\nbody b');
    expect(s.map((x) => x.heading)).toEqual(['A', 'B']);
    expect(s[0]!.body.trim()).toBe('body a');
  });

  it('normalises terms case- and whitespace-insensitively', () => {
    expect(normaliseTerm('  FTLE ')).toBe('ftle');
    expect(normaliseTerm('Shape   Sphere')).toBe('shape sphere');
  });
});

describe('docs index ↔ required pages', () => {
  const index = readDoc(DOCS_MANIFEST.index);

  it('every required page exists on disk', () => {
    for (const page of DOCS_MANIFEST.requiredPages) {
      expect(existsInDocs(page), `missing docs page: ${page}`).toBe(true);
    }
  });

  it('the index links every required page', () => {
    const checks = checkIndexLinksPages(index, DOCS_MANIFEST.requiredPages);
    expect(failures(checks), failures(checks).join('\n')).toEqual([]);
    expect(allOk(checks)).toBe(true);
  });
});

describe('docs index ↔ milestones/README.md coverage', () => {
  it('the docs index links every milestone in the milestone index', () => {
    const files = milestoneFiles();
    expect(files.length).toBeGreaterThanOrEqual(13);
    const checks = checkMilestoneCoverage(readDoc(DOCS_MANIFEST.index), files);
    expect(failures(checks), failures(checks).join('\n')).toEqual([]);
  });

  it('includes this very milestone (G16)', () => {
    expect(milestoneFiles()).toContain('G16_documentation_onboarding.md');
  });
});

describe('ADR index ↔ docs/adr coverage', () => {
  it('adr-index.md links every ratified ADR record', () => {
    const files = adrFiles();
    expect(files).toContain('0001-checkpoint-schedule.md');
    expect(files.length).toBeGreaterThanOrEqual(7);
    const checks = checkAdrCoverage(readDoc(DOCS_MANIFEST.adrIndexPage), files);
    expect(failures(checks), failures(checks).join('\n')).toEqual([]);
  });
});

describe('glossary completeness', () => {
  const glossary = readDoc(DOCS_MANIFEST.glossaryPage);

  it('defines every required term with non-empty prose', () => {
    const checks = checkGlossaryTerms(glossary, DOCS_MANIFEST.glossaryTerms);
    expect(failures(checks), failures(checks).join('\n')).toEqual([]);
    expect(checks.length).toBe(DOCS_MANIFEST.glossaryTerms.length);
  });

  it('flags a missing term (negative control)', () => {
    const checks = checkGlossaryTerms('## Only This\ndef', ['Nonexistent Term']);
    expect(allOk(checks)).toBe(false);
  });

  it('flags an empty definition (negative control)', () => {
    const checks = checkGlossaryTerms('## FTLE\n\n## Next\nx', ['FTLE']);
    expect(allOk(checks)).toBe(false);
  });
});

describe('intra-doc relative links resolve', () => {
  it('every relative link in every docs page points at a real file', () => {
    const pages = listDocPages();
    expect(pages.has(DOCS_MANIFEST.index)).toBe(true);
    const checks = checkRelativeLinks(pages, existsInDocs);
    expect(failures(checks), failures(checks).join('\n')).toEqual([]);
  });

  it('detects a broken link (negative control)', () => {
    const pages = new Map([['README.md', 'see [x](missing.md)']]);
    const checks = checkRelativeLinks(pages, () => false);
    expect(allOk(checks)).toBe(false);
    expect(failures(checks)[0]).toMatch(/broken link/);
  });
});
