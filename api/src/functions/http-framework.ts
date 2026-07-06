import { getFramework } from '../data/framework'
import { api, ok } from '../shared/http'

// GET /api/framework → FrameworkDoc — the fixed engine/doctrine documents the
// tool strictly runs under. Read-only: the documents ship with the tool and are
// not editable or uploadable, so there is no PUT. The legacy `register: []` is
// kept in the payload so pre-removal frontend bundles render an empty exemplar
// register instead of crashing during the deploy-skew window.
api({
  name: 'framework-get',
  methods: ['GET'],
  route: 'framework',
  handler: async () => ok({ ...getFramework(), register: [] }),
})
