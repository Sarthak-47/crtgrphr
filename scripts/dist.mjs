/**
 * Build the app and package it with electron-builder, keeping every download
 * cache inside the project folder (electron-builder otherwise uses
 * %LOCALAPPDATA%\electron-builder). Extra arguments go to electron-builder,
 * e.g. `--dir` for an unpacked folder, `--linux`, `--publish never`.
 *
 * On Windows, electron-builder's winCodeSign toolkit (rcedit, used to stamp the
 * icon and version into the .exe) ships macOS symlinks that Windows can't create
 * without admin rights or Developer Mode, which makes packaging fail. We set the
 * toolkit up ourselves first, skipping the macOS folder it doesn't need.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
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
/** Run a package's CLI script with this Node (no shell, so no argument quoting pitfalls). */
const run = (script, args) => {
  const r = spawnSync(process.execPath, [join(root, 'node_modules', script), ...args], { cwd: root, env, stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

const WIN_CODE_SIGN = 'winCodeSign-2.6.0'
const WIN_CODE_SIGN_URL = `https://github.com/electron-userland/electron-builder-binaries/releases/download/${WIN_CODE_SIGN}/${WIN_CODE_SIGN}.7z`

async function ensureWinCodeSign() {
  const dir = join(builderCache, 'winCodeSign')
  const target = join(dir, WIN_CODE_SIGN)
  if (existsSync(join(target, 'rcedit-x64.exe'))) return
  mkdirSync(dir, { recursive: true })
  const archive = join(dir, `${WIN_CODE_SIGN}.7z`)
  if (!existsSync(archive)) {
    console.log(`Downloading ${WIN_CODE_SIGN} into the project cache…`)
    const res = await fetch(WIN_CODE_SIGN_URL)
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`)
    writeFileSync(archive, Buffer.from(await res.arrayBuffer()))
  }
  const sevenZip = createRequire(import.meta.url)('7zip-bin').path7za
  rmSync(target, { recursive: true, force: true })
  const r = spawnSync(sevenZip, ['x', '-bd', '-y', archive, `-o${target}`, '-xr!darwin'], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`Extracting ${WIN_CODE_SIGN} failed`)
  // Remove partial extractions left by earlier failed electron-builder attempts.
  for (const name of readdirSync(dir)) {
    if (/^\d+(\.7z)?$/.test(name)) rmSync(join(dir, name), { recursive: true, force: true })
  }
}

if (process.platform === 'win32') await ensureWinCodeSign()
run('electron-vite/bin/electron-vite.js', ['build'])
run('electron-builder/cli.js', process.argv.slice(2))
