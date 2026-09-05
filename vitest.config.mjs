import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Match @preact/preset-vite's react aliases (see vite.config.ts) so
    // importing ai-settings-ui — which imports 'react' — resolves under
    // vitest's plain Node environment too.
    alias: {
      'react-dom/test-utils': 'preact/test-utils',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
      react: 'preact/compat',
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['dotenv/config'],
    testTimeout: 15000,
    fileParallelism: false,
  },
});
