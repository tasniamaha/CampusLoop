import { defineConfig } from 'vitest/config';

// Lost-and-found matching evaluation (project.md §7). Not part of npm test: it writes
// docs/matching-eval.md and, on request, the frozen dataset. Runs in one worker so the
// latency numbers are not skewed by parallel files.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/matching/**/*.eval.ts'],
    fileParallelism: false,
    testTimeout: 600_000,
  },
});
