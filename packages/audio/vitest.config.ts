import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // DSP tests render real audio in Node; give them headroom on a loaded machine.
    testTimeout: 30_000,
  },
});
