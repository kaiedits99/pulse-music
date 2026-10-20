import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// The version baked into this build, shown in the app and compared with the newest release so an
// installed Android copy can say "there is a newer one". Set VITE_APP_VERSION in CI (the release
// tag) or it falls back to client/package.json.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const appVersion = process.env.VITE_APP_VERSION || pkg.version || '0.0.0';

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion)
  },
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:8080',
      '/media': 'http://localhost:8080'
    }
  },
  build: {
    outDir: 'dist'
  }
});
