import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false, // tests share one database; run files one after another
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
