import { resolve } from 'node:path';
import { withPageConfig } from '@extension/vite-config';

const rootDir = resolve(__dirname);
const srcDir = resolve(rootDir, 'src');

export default withPageConfig({
  resolve: {
    alias: {
      '@src': srcDir,
      // The trace dashboard shares the background's record rollups; the module is pure (no Dexie, no chrome.*).
      '@trace-summary': resolve(rootDir, '..', '..', 'chrome-extension', 'src', 'background', 'trace-summary.ts'),
    },
  },
  publicDir: resolve(rootDir, 'public'),
  build: {
    outDir: resolve(rootDir, '..', '..', 'dist', 'options'),
  },
});
