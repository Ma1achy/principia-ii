export {
  DOCS_MANIFEST, DEFAULT_LAYOUT, normaliseTerm,
  type DocsManifest, type DocsLayout,
} from './manifest.js';
export {
  stripCode, parseLinks, isExternal, stripAnchor, relativeLinkTargets,
  checkIndexLinksPages, checkMilestoneCoverage, checkAdrCoverage,
  checkGlossaryTerms, parseHeadingSections, checkRelativeLinks,
  posixDirname, posixResolve, allOk, failures,
  type MdLink, type Check, type HeadingSection,
} from './completeness.js';
