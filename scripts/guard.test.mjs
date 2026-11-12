/**
 * Tests for scripts/guard.mjs. Run with `node --test` (wired into `pnpm test`).
 * Every fixture is created in a fresh temporary directory; nothing real is ever read.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./guard.mjs', import.meta.url));
/** The forbidden name in mixed case, built from fragments (never written as one literal). */
const MIXED_CASE_NAME = ['DrOp', 'MiX'].join('');

let dir;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'stemdeck-guard-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Create a file inside the temp dir and return its relative path. */
function put(rel, content = 'hello\n') {
  const abs = path.join(dir, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return rel;
}

/** Run the guard with cwd = temp dir. */
function guard(...args) {
  const res = spawnSync(process.execPath, [GUARD, ...args], { cwd: dir, encoding: 'utf8' });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

describe('guard: explicit paths', () => {
  test('passes ordinary source files', () => {
    const files = [put('src/a.ts', 'export const a = 1;\n'), put('README.md', '# STEMDECK\n')];
    const { code, out } = guard(...files);
    assert.equal(code, 0, out);
    assert.match(out, /ok \(2 files checked\)/);
  });

  test('blocks a .flac file', () => {
    const { code, out } = guard(put('songs/track.flac', 'not really audio'));
    assert.equal(code, 1);
    assert.match(out, /songs\/track\.flac: \[audio\]/);
  });

  test('blocks every audio extension, case-insensitively', () => {
    const exts = ['wav', 'mp3', 'm4a', 'm4p', 'ogg', 'opus', 'aac', 'aif', 'aiff', 'wma', 'FLAC'];
    for (const ext of exts) {
      const { code, out } = guard(put(`x.${ext}`));
      assert.equal(code, 1, `.${ext} should be blocked`);
      assert.match(out, /\[audio\]/);
    }
  });

  test('blocks a .stemdeck pack', () => {
    const { code, out } = guard(put('packs/mine.stemdeck', 'PK'));
    assert.equal(code, 1);
    assert.match(out, /packs\/mine\.stemdeck: \[audio\]/);
  });

  test('blocks anything under library/', () => {
    const { code, out } = guard(put('library/cache/notes.txt', 'just text'));
    assert.equal(code, 1);
    assert.match(out, /library\/cache\/notes\.txt: \[library\]/);
  });

  test('allows a nested directory that is merely called library', () => {
    const { code, out } = guard(put('apps/web/src/library/index.ts', 'export {};\n'));
    assert.equal(code, 0, out);
  });

  test('blocks a 6 MB file and allows a 5 MB one', () => {
    const big = put('big.bin', Buffer.alloc(6 * 1024 * 1024, 1));
    const ok = put('ok.bin', Buffer.alloc(5 * 1024 * 1024, 1));
    const blocked = guard(big);
    assert.equal(blocked.code, 1);
    assert.match(blocked.out, /big\.bin: \[size\] 6\.0 MB/);
    assert.equal(guard(ok).code, 0);
  });

  test('blocks text content containing the original game name in mixed case', () => {
    const { code, out } = guard(put('docs/notes.md', `inspired by ${MIXED_CASE_NAME}, sort of\n`));
    assert.equal(code, 1);
    assert.match(out, /docs\/notes\.md: \[name\] the content/);
  });

  test('blocks a path containing the original game name', () => {
    const { code, out } = guard(put(`src/${MIXED_CASE_NAME.toLowerCase()}-clone.ts`, '\n'));
    assert.equal(code, 1);
    assert.match(out, /\[name\] the path/);
  });

  test('skips binary files for the content rule', () => {
    const bin = Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(MIXED_CASE_NAME)]);
    const { code, out } = guard(put('img.png', bin));
    assert.equal(code, 0, out);
  });

  test('exempts only the guard and its test from the name rule', () => {
    const text = `const n = '${MIXED_CASE_NAME}';\n`;
    assert.equal(guard(put('scripts/guard.mjs', text)).code, 0);
    assert.equal(guard(put('scripts/guard.test.mjs', text)).code, 0);
    assert.equal(guard(put('scripts/other.mjs', text)).code, 1);
  });

  test('reports every problem with the file and the rule', () => {
    const { code, out } = guard(put('library/a.wav'), put('fine.txt'));
    assert.equal(code, 1);
    assert.match(out, /library\/a\.wav: \[audio\]/);
    assert.match(out, /library\/a\.wav: \[library\]/);
    assert.match(out, /blocked 2 problems/);
  });
});

describe('guard: git modes', () => {
  function gitIn(...args) {
    return execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  }

  test('default mode checks the staged version of each file', () => {
    gitIn('init', '-q');
    put('a.txt', 'clean\n');
    gitIn('add', 'a.txt');
    assert.equal(guard().code, 0);

    // Stage a bad version, then clean the working tree: the staged blob is what gets committed.
    put('a.txt', `${MIXED_CASE_NAME}\n`);
    gitIn('add', 'a.txt');
    put('a.txt', 'clean again\n');
    const { code, out } = guard();
    assert.equal(code, 1);
    assert.match(out, /a\.txt: \[name\]/);
  });

  test('default mode blocks a staged audio file', () => {
    gitIn('init', '-q');
    put('loop.ogg', 'x');
    gitIn('add', '-f', 'loop.ogg');
    const { code, out } = guard();
    assert.equal(code, 1);
    assert.match(out, /loop\.ogg: \[audio\]/);
  });

  test('default mode checks a staged type change (symlink replaced by a file)', () => {
    gitIn('init', '-q');
    symlinkSync('target.txt', path.join(dir, 'notes.txt'));
    gitIn('add', 'notes.txt');
    gitIn('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'link');
    rmSync(path.join(dir, 'notes.txt'));
    put('notes.txt', `${MIXED_CASE_NAME}\n`);
    gitIn('add', 'notes.txt');
    const { code, out } = guard();
    assert.equal(code, 1, out);
    assert.match(out, /notes\.txt: \[name\]/);
  });

  test('--all checks every tracked file', () => {
    gitIn('init', '-q');
    put('ok.ts', 'export {};\n');
    put('library/song.txt', 'x');
    gitIn('add', '-f', 'ok.ts', 'library/song.txt');
    const { code, out } = guard('--all');
    assert.equal(code, 1);
    assert.match(out, /library\/song\.txt: \[library\]/);
    assert.doesNotMatch(out, /ok\.ts/);
  });
});

describe('guard: commit messages', () => {
  test('passes an ordinary message', () => {
    const { code, out } = guard('--message', put('MSG', 'feat(audio): add the render pool\n'));
    assert.equal(code, 0, out);
  });

  test('blocks a message containing the original game name in mixed case', () => {
    const { code, out } = guard(
      '--message',
      put('MSG', `fix: make it more like ${MIXED_CASE_NAME}\n`),
    );
    assert.equal(code, 1);
    assert.match(out, /commit message: \[name\]/);
  });

  test('ignores comment lines that git strips', () => {
    const { code, out } = guard('--message', put('MSG', `chore: tidy\n# ${MIXED_CASE_NAME}\n`));
    assert.equal(code, 0, out);
  });

  test('fails with usage when the file is missing from the arguments', () => {
    assert.equal(guard('--message').code, 2);
  });
});
