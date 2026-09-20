import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

// @types/node is not installed, so reach process.env through globalThis.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

export default defineConfig({
  plugins: [preact(), tailwindcss()],
  resolve: {
    // ai-settings-ui is consumed via a `file:` dependency (npm publish is
    // blocked upstream — see publish.sh), so node_modules/ai-settings-ui is
    // a symlink to a sibling project. Without preserveSymlinks, Vite resolves
    // the package's bare imports (e.g. preact/compat, aliased from react/
    // react-dom by @preact/preset-vite) against the real path's own
    // directory tree instead of this project's node_modules, and fails to
    // find them there.
    preserveSymlinks: true,
  },
  server: {
    host: '0.0.0.0',
    port: Number(env.DEV_PORT) || 3577,
    strictPort: true,
    proxy: {
      '/api': {
        target: env.API_TARGET || 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
