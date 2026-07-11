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

// Doctrine library (Stein et al. chapter excerpts) — consulted at card
// generation for the Instructional Approach.
const doctrineSrc = join(here, '..', 'assets', 'doctrine')
if (existsSync(doctrineSrc)) {
  cpSync(doctrineSrc, join(dstDir, 'doctrine'), { recursive: true })
  console.log(`copy-assets: copied doctrine/ -> ${join(dstDir, 'doctrine')}`)
} else {
  console.error('copy-assets: assets/doctrine is missing - the doctrine library must ship with the API')
  process.exit(1)
}

// Teaching-format script library (Stein et al., all 122 verbatim formats with
// page numbers) — the Video Script Generator's page-targeted doctrine source.
const formatsSrc = join(here, '..', 'assets', 'formats.json')
if (existsSync(formatsSrc)) {
  cpSync(formatsSrc, join(dstDir, 'formats.json'))
  console.log(`copy-assets: copied formats.json -> ${join(dstDir, 'formats.json')}`)
} else {
  console.error('copy-assets: assets/formats.json is missing - the format library must ship with the API')
  process.exit(1)
}

// Cover-to-cover textbook corpus (all 18 chapters + appendices, page-stamped)
// — the VSG rulebook's doctrine source: the whole book is AVAILABLE, retrieval
// stays page-targeted (rulebook §13.5).
const textbookSrc = join(here, '..', 'assets', 'textbook')
if (existsSync(textbookSrc)) {
  cpSync(textbookSrc, join(dstDir, 'textbook'), { recursive: true })
  console.log(`copy-assets: copied textbook/ -> ${join(dstDir, 'textbook')}`)
} else {
  console.error('copy-assets: assets/textbook is missing - the textbook corpus must ship with the API')
  process.exit(1)
}
