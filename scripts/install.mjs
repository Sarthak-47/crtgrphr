// Install dependencies with every download kept inside the project folder.
//   node scripts/install.mjs            (npm ci)
//   node scripts/install.mjs install x  (any npm command)
// .npmrc already keeps npm's cache in ./.npm-cache, but Electron's own installer
// only reads `electron_config_cache` from the environment, which .npmrc can't
// set; without it the Electron binary goes to the user's global cache.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const res = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args.length ? args : ['ci'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    electron_config_cache: join(root, '.electron-cache'),
    ELECTRON_BUILDER_CACHE: join(root, '.electron-builder-cache'),
  },
})
process.exit(res.status ?? 1)
