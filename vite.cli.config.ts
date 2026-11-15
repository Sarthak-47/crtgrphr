/**
 * Builds the command-line tool into one self-contained file, action/dist/crtgrphr.mjs,
 * with every dependency bundled. That file is committed so the GitHub Action (and
 * `node action/dist/crtgrphr.mjs`) runs with no install step. CI checks that the
 * committed bundle matches the source.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'))

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer/src'),
    },
  },
  define: { __CRTGRPHR_VERSION__: JSON.stringify(pkg.version) },
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: resolve(__dirname, 'src/cli/index.ts'),
    outDir: 'action/dist',
    emptyOutDir: true,
    target: 'node18',
    minify: false,
    sourcemap: false,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        format: 'es',
        entryFileNames: 'crtgrphr.mjs',
        inlineDynamicImports: true,
        banner: '#!/usr/bin/env node',
      },
    },
  },
})
