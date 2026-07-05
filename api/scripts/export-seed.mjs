// Exports the frontend seed data (src/data/seed.ts) to api/assets/seed.json.
// Runs under the `tsx` devDependency so the TypeScript module graph resolves:
//   tsx scripts/export-seed.mjs   (wired as the `prebuild` script)
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { seedSets, seedScope } from '../../src/data/seed.ts'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'assets')
mkdirSync(outDir, { recursive: true })

const payload = { sets: seedSets, scope: seedScope }
const outPath = join(outDir, 'seed.json')
writeFileSync(outPath, JSON.stringify(payload, null, 2))
console.log(`export-seed: wrote ${outPath} (${seedSets.length} sets, 1 scope)`)
