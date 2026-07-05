import { FrameworkDoc } from '../domain/types'
import { getFramework, saveFramework } from '../data/framework'
import { HttpError } from '../shared/errors'
import { api, ok, readJson } from '../shared/http'

// GET /api/framework → FrameworkDoc — the governing engine/doctrine documents
// and the Exemplar Asset Register the tool strictly runs under.
api({
  name: 'framework-get',
  methods: ['GET'],
  route: 'framework',
  handler: async () => ok(await getFramework()),
})

// PUT /api/framework  FrameworkDoc → FrameworkDoc — replaces the framework.
// Edited sections get a version bump; the doc then stays locked until the next edit.
api({
  name: 'framework-put',
  methods: ['PUT'],
  route: 'framework',
  handler: async (req) => {
    const body = await readJson<Partial<FrameworkDoc>>(req)
    if (!body.engine?.content?.trim() || !body.doctrine?.content?.trim()) {
      throw new HttpError(400, 'engine and doctrine content are required — the tool cannot run without its framework')
    }
    if (!Array.isArray(body.register)) throw new HttpError(400, 'register must be an array')
    return ok(await saveFramework(body as FrameworkDoc))
  },
})
