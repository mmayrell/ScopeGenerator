// Copies api/assets into api/dist/assets so the deployed package (which stages
// dist/ + host.json + package.json + node_modules) carries the seed data.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..', 'assets', 'seed.json')
const dstDir = join(here, '..', 'dist', 'assets')

if (!existsSync(src)) {
  console.error('copy-assets: assets/seed.json is missing - the prebuild (export-seed) step did not run')
  process.exit(1)
}
mkdirSync(dstDir, { recursive: true })
cpSync(src, join(dstDir, 'seed.json'))
console.log(`copy-assets: copied seed.json -> ${join(dstDir, 'seed.json')}`)
