#!/usr/bin/env node
/**
 * Branch-policy guard — `main` is untouchable.
 *
 * PreToolUse(Bash) hook. Blocks any git/gh command that would touch the
 * protected `main` branch: committing/merging/rebasing/resetting while on main,
 * pushing to main, force-moving main, switching to main, or opening a PR whose
 * base is main (or unspecified, since the repo default may be main).
 *
 * All work targets `webgpu-rewrite`. See CLAUDE.md → "Branch policy".
 *
 * Exit 0 = allow. Exit 2 = block (stderr is fed back to the model).
 */
const { execSync } = require('node:child_process');
const fs = require('node:fs');

const PROTECTED = 'main';
const INTEGRATION = 'webgpu-rewrite';

function deny(reason) {
  process.stderr.write(
    `BLOCKED by branch policy: ${reason}. ` +
      `'${PROTECTED}' is untouchable — branch off and target '${INTEGRATION}' ` +
      `(see CLAUDE.md → "Branch policy").\n`
  );
  process.exit(2);
}

let raw = '';
try {
  raw = fs.readFileSync(0, 'utf8');
} catch {
  process.exit(0); // no stdin → nothing to inspect
}

let payload;
try {
  payload = JSON.parse(raw || '{}');
} catch {
  process.exit(0); // unparseable → fail open (don't wedge unrelated tools)
}

const cmd = payload?.tool_input?.command;
if (typeof cmd !== 'string' || !cmd.trim()) process.exit(0);

// Tokenize one segment, respecting quotes so commit/PR message text can never
// be mistaken for a bareword argument like `main`.
function tokenize(s) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
  }
  return out;
}

let branch = '';
try {
  branch = execSync('git rev-parse --abbrev-ref HEAD', {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .toString()
    .trim();
} catch {
  /* not a repo / detached HEAD → branch-state checks simply won't fire */
}

const MUTATING = new Set([
  'commit',
  'merge',
  'rebase',
  'cherry-pick',
  'reset',
  'revert',
  'am',
  'push',
]);

// Inspect each sub-command in a compound line independently.
for (const seg of cmd.split(/&&|\|\||;|\|/)) {
  const tokens = tokenize(seg.trim()).filter((t) => t.length > 0);
  if (tokens.length === 0) continue;
  const exe = tokens[0];
  if (exe !== 'git' && exe !== 'gh') continue;

  const args = tokens.slice(1);
  const barewords = new Set(args.filter((a) => !a.startsWith('-')));
  const sub = args.find((a) => !a.startsWith('-')) || '';

  if (exe === 'git') {
    if ((sub === 'checkout' || sub === 'switch') && barewords.has(PROTECTED)) {
      deny(`switching to ${PROTECTED}`);
    }
    if (
      sub === 'branch' &&
      args.some((a) => /^-[A-Za-z]*f/.test(a)) &&
      barewords.has(PROTECTED)
    ) {
      deny(`force-moving ${PROTECTED}`);
    }
    if (
      sub === 'push' &&
      args.some(
        (a) => a === PROTECTED || new RegExp(`(^|:)(refs/heads/)?${PROTECTED}$`).test(a)
      )
    ) {
      deny(`pushing to ${PROTECTED}`);
    }
    if (branch === PROTECTED && MUTATING.has(sub)) {
      deny(`running 'git ${sub}' while on ${PROTECTED}`);
    }
  }

  if (exe === 'gh' && sub === 'pr' && barewords.has('create')) {
    const eq = args.find((a) => a.startsWith('--base='));
    const flagIdx = args.findIndex((a) => a === '--base' || a === '-B');
    const base = eq
      ? eq.slice('--base='.length)
      : flagIdx >= 0
        ? args[flagIdx + 1]
        : '';
    if (base === PROTECTED) deny(`opening a PR against ${PROTECTED}`);
    if (!base) {
      deny(
        `opening a PR with no --base (repo default may be ${PROTECTED}; ` +
          `pass --base ${INTEGRATION})`
      );
    }
  }
}

process.exit(0);
