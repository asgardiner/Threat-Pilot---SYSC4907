import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@kernel': fromRoot('./src/kernel'),
      '@plugins': fromRoot('./src/plugins'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Provides the browser APIs React Flow needs when a test opts into jsdom.
    setupFiles: ['src/test/setup.ts'],
  },
});