/**
 * Runs `playwright test` with the given arguments.
 *
 * `pnpm e2e -- --trace off` forwards a literal `--` through each nested pnpm script, and
 * Playwright then ignores every option after it. This wrapper drops the `--` separators so
 * options such as `--trace off` or `--project mobile-360` reach Playwright.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const args = process.argv.slice(2).filter((a) => a !== '--');
const res = spawnSync(process.execPath, [cli, 'test', ...args], { stdio: 'inherit' });
process.exit(res.status ?? 1);
