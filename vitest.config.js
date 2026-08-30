import { defineConfig } from 'vitest/config';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

/**
 * The Worker sources are TypeScript but import each other with `.js`
 * specifiers, which is what TypeScript requires for ESM output and what
 * wrangler/esbuild expects. Vitest resolves specifiers literally, so this
 * plugin maps `./x.js` back to the `./x.ts` on disk.
 *
 * The alternative — dropping extensions in the Worker source — would break the
 * real build to make the test runner happy, which is the wrong way round.
 */
function tsExtensionResolver() {
  return {
    name: 'ts-extension-resolver',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.') || !source.endsWith('.js')) return null;
      const asTs = resolve(dirname(importer), source.replace(/\.js$/, '.ts'));
      return existsSync(asTs) ? asTs : null;
    },
  };
}

export default defineConfig({
  plugins: [tsExtensionResolver()],
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    reporters: ['default'],
    coverage: {
      include: ['shared/**/*.js', 'worker/src/**/*.ts'],
    },
  },
});
