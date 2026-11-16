/**
 * Build the app and package it with electron-builder, keeping every download
 * cache inside the project folder (electron-builder otherwise uses
 * %LOCALAPPDATA%\electron-builder). Extra arguments go to electron-builder,
 * e.g. `--dir` for an unpacked folder, `--linux`, `--publish never`.
 *
 * (Up to electron-builder 25 this script also pre-extracted the winCodeSign
 * toolkit, whose macOS symlinks Windows can't create without admin rights.
 * electron-builder 26 stamps the .exe without it, so that step is gone.)
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const builderCache = process.env.ELECTRON_BUILDER_CACHE ?? join(root, '.electron-builder-cache')
const env = {
  ...process.env,
  ELECTRON_CACHE: process.env.ELECTRON_CACHE ?? join(root, '.electron-cache'),
  ELECTRON_BUILDER_CACHE: builderCache,
  // No signing identity is configured; don't go looking for one.
  CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY ?? 'false',
}
// Tools electron-builder downloads into its cache (e.g. the icon converter) are
// CommonJS .js files. The cache sits inside this project, whose package.json says
// "type": "module", so Node would load them as ES modules and they'd crash. A
// package.json in the cache marks everything below it as CommonJS.
mkdirSync(builderCache, { recursive: true })
writeFileSync(join(builderCache, 'package.json'), '{ "type": "commonjs" }' + String.fromCharCode(10))

/** Run a package's CLI script with this Node (no shell, so no argument quoting pitfalls). */
const run = (script, args) => {
  const r = spawnSync(process.execPath, [join(root, 'node_modules', script), ...args], { cwd: root, env, stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

run('electron-vite/bin/electron-vite.js', ['build'])
run('electron-builder/cli.js', process.argv.slice(2))
