import * as fs from 'node:fs'
import * as path from 'node:path'
import { Scope, StandardSet } from '../domain/types'
import { entitiesTableHasRows, saveScope, saveSet, snapshotScope } from '../data/entities'
import { HttpError } from '../shared/errors'
import { api, ok } from '../shared/http'

const VERSION = '1.0.0'

// GET /api/health -> { ok: true, version } - the only unauthenticated endpoint.
api({
  name: 'health',
  methods: ['GET'],
  route: 'health',
  auth: false,
  handler: async () => ok({ ok: true, version: VERSION }),
})

interface SeedFile {
  sets: StandardSet[]
  scope: Scope
}

function loadSeed(): SeedFile {
  // Compiled location is dist/src/functions/; seed.json lives at dist/assets/
  // (copied by the build) with api/assets/ as the source-tree fallback.
  const candidates = [
    path.resolve(__dirname, '..', '..', 'assets', 'seed.json'),
    path.resolve(__dirname, '..', '..', '..', 'assets', 'seed.json'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return JSON.parse(fs.readFileSync(candidate, 'utf8')) as SeedFile
    }
  }
  throw new HttpError(500, 'seed.json not found - run `npm run build` in api/ to export it')
}

// POST /api/ops/seed?force=true -> { seeded, sets, scopes }
// Loads the bundled seed.json into tables/blobs when the entities table is
// empty (or force). Stamps the seeded scope's protected boundary so the
// U3.L3/U3.L4 merge guardrail behaves exactly as src/store.tsx does today.
api({
  name: 'admin-seed',
  methods: ['POST'],
  route: 'ops/seed',
  handler: async (req) => {
    const force = req.query.get('force') === 'true'
    if (!force && (await entitiesTableHasRows())) {
      return ok({ seeded: false, sets: 0, scopes: 0 })
    }
    const seed = loadSeed()
    for (const set of seed.sets) {
      await saveSet(set)
    }
    const scope: Scope = {
      ...seed.scope,
      protectedBoundaries: [['U3.L3', 'U3.L4']],
    }
    await saveScope(scope)
    await snapshotScope(scope)
    return ok({ seeded: true, sets: seed.sets.length, scopes: 1 })
  },
})
