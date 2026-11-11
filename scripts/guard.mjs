#!/usr/bin/env node
/**
 * Repository guard: keeps user content and the original game's name out of git.
 *
 * Usage:
 *   node scripts/guard.mjs              check the files staged for commit (pre-commit hook)
 *   node scripts/guard.mjs --all        check every tracked file (`pnpm guard`, CI)
 *   node scripts/guard.mjs <paths...>   check these files (relative to the current directory)
 *
 * A file fails when:
 *   audio      its extension is an audio format or `.stemdeck`
 *   library    it is under `library/` (the user's songs, caches and built packs)
 *   size       it is larger than 5 MB
 *   name       its path, or its text content, contains the original 2017 game's name
 *              (case-insensitive; binary files are skipped for content)
 *
 * No dependencies: Node built-ins only. See CLAUDE.md ("Working rules") and
 * docs/BUILD_PROMPT.md §13.6.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_BYTES = 5 * 1024 * 1024;

export const BLOCKED_EXTENSIONS = new Set([
  '.flac',
  '.wav',
  '.mp3',
  '.m4a',
  '.m4p',
  '.ogg',
  '.opus',
  '.aac',
  '.aif',
  '.aiff',
  '.wma',
  '.stemdeck',
]);

/**
 * The forbidden name, assembled at runtime so that this file never contains it as a literal
 * (and so that a search of the repository for it finds nothing).
 */
const NEEDLE = ['drop', 'mix'].join('');

/** Files allowed to talk about the forbidden name (they still never contain it literally). */
const NAME_RULE_EXEMPT = new Set(['scripts/guard.mjs', 'scripts/guard.test.mjs']);

/** Same heuristic as git: a NUL byte in the first 8000 bytes means binary. */
function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

function toPosix(p) {
  return p.split(path.sep).join('/').replaceAll('\\', '/');
}

/**
 * Check one file. `size()` and `read()` are lazy so a huge file is never read into memory.
 * @param {{ path: string, size: () => number | null, read: () => Buffer | null }} file
 * @returns {{ path: string, rule: string, message: string }[]}
 */
export function checkFile(file) {
  const rel = toPosix(file.path).replace(/^\.\//, '');
  const lower = rel.toLowerCase();
  const problems = [];
  const fail = (rule, message) => problems.push({ path: rel, rule, message });

  const ext = path.posix.extname(lower);
  if (BLOCKED_EXTENSIONS.has(ext)) {
    fail('audio', `${ext} files are user content and must never be committed`);
  }
  if (lower === 'library' || lower.startsWith('library/')) {
    fail('library', 'library/ holds the user’s songs, caches and packs and is never committed');
  }

  const exempt = NAME_RULE_EXEMPT.has(rel);
  if (!exempt && lower.includes(NEEDLE)) {
    fail('name', 'the path contains the original game’s name');
  }

  const size = file.size();
  if (size !== null && size > MAX_BYTES) {
    fail('size', `${(size / 1024 / 1024).toFixed(1)} MB is over the 5 MB limit`);
    return problems;
  }

  if (!exempt && size !== null) {
    const buf = file.read();
    if (buf && !isBinary(buf) && buf.toString('utf8').toLowerCase().includes(NEEDLE)) {
      fail('name', 'the content contains the original game’s name');
    }
  }
  return problems;
}

function git(args, opts = {}) {
  return execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024, ...opts });
}

function splitZ(buf) {
  return buf.toString('utf8').split('\0').filter(Boolean);
}

/** A file in the working tree, relative to `root`. Missing files report size null. */
function worktreeFile(root, rel) {
  const abs = path.resolve(root, rel);
  return {
    path: path.isAbsolute(rel) ? toPosix(path.relative(root, abs)) : rel,
    size: () => {
      try {
        const st = statSync(abs);
        return st.isFile() ? st.size : null;
      } catch {
        return null;
      }
    },
    read: () => readFileSync(abs),
  };
}

/** A file as it is staged in the index (what will actually be committed). */
function stagedFile(root, rel) {
  return {
    path: rel,
    size: () => {
      try {
        return Number(git(['cat-file', '-s', `:${rel}`], { cwd: root, stdio: 'pipe' }).toString());
      } catch {
        return null; // not a blob (e.g. a submodule)
      }
    },
    read: () => git(['cat-file', 'blob', `:${rel}`], { cwd: root }),
  };
}

function repoRoot() {
  return git(['rev-parse', '--show-toplevel']).toString().trim();
}

function collect(argv) {
  if (argv.includes('--all')) {
    const root = repoRoot();
    return splitZ(git(['ls-files', '-z'], { cwd: root })).map((p) => worktreeFile(root, p));
  }
  const paths = argv.filter((a) => !a.startsWith('--'));
  if (paths.length > 0) {
    return paths.map((p) => worktreeFile(process.cwd(), p));
  }
  const root = repoRoot();
  const staged = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'], {
    cwd: root,
  });
  return splitZ(staged).map((p) => stagedFile(root, p));
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('usage: node scripts/guard.mjs [--all | <paths...>]  (default: staged files)');
    return 0;
  }
  const files = collect(argv);
  const problems = files.flatMap(checkFile);
  if (problems.length === 0) {
    console.log(`guard: ok (${files.length} file${files.length === 1 ? '' : 's'} checked)`);
    return 0;
  }
  for (const p of problems) console.error(`guard: ${p.path}: [${p.rule}] ${p.message}`);
  console.error(
    `guard: blocked ${problems.length} problem${problems.length === 1 ? '' : 's'}. ` +
      'Audio, .stemdeck packs, library/, files over 5 MB and the original game’s name ' +
      'never go into git (see CLAUDE.md).',
  );
  return 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = main();
