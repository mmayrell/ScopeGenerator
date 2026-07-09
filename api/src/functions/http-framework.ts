import { BlobSASPermissions } from '@azure/storage-blob'
import { getFramework } from '../data/framework'
import { uploadsContainer } from '../data/clients'
import { HttpError } from '../shared/errors'
import { api, ok, requireParam } from '../shared/http'

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

// ---------------------------------------------------------------------------
// Framework source PDFs — the full engine/doctrine documents as downloadable
// files, stored in the `uploads` container at framework/<kind>.pdf. Unlike the
// framework TEXT above (compiled into the code), the PDFs are too large to
// ship in the deployment package (the doctrine source is a ~61 MB textbook),
// so they live in blob storage and are replaced via the authenticated PUT
// below whenever a new edition is adopted.
// ---------------------------------------------------------------------------

const KINDS = ['engine', 'doctrine'] as const
type FrameworkKind = (typeof KINDS)[number]

/** The filename the browser saves — derived from the tile names in data/framework.ts. */
const downloadNameOf = (kind: FrameworkKind): string =>
  `${getFramework()[kind].name.replace(/[\\/:*?"<>|]/g, '')}.pdf`

function requireKind(req: Parameters<Parameters<typeof api>[0]['handler']>[0]): FrameworkKind {
  const kind = requireParam(req, 'kind') as FrameworkKind
  if (!KINDS.includes(kind)) throw new HttpError(400, `kind must be one of: ${KINDS.join(', ')}`)
  return kind
}

// GET /api/framework-file/{kind} → 302 to a short-lived read-only blob SAS.
// Opened as a browser navigation (which can't attach the x-access-code
// header), so auth also accepts ?code= — mirrors library-file. The redirect
// lets the browser download straight from storage instead of pushing tens of
// megabytes through the Function App; the SAS overrides content-disposition
// so the file saves under its display name.
api({
  name: 'framework-file-get',
  methods: ['GET'],
  route: 'framework-file/{kind}',
  auth: false,
  handler: async (req) => {
    const expected = process.env.APP_ACCESS_CODE
    const supplied = req.headers.get('x-access-code') ?? req.query.get('code')
    if (!expected || supplied !== expected) {
      return { status: 401, jsonBody: { error: 'unauthorized' } }
    }
    const kind = requireKind(req)
    const blob = uploadsContainer().getBlobClient(`framework/${kind}.pdf`)
    if (!(await blob.exists())) throw new HttpError(404, `no ${kind} PDF has been uploaded yet`)
    const url = await blob.generateSasUrl({
      permissions: BlobSASPermissions.parse('r'),
      expiresOn: new Date(Date.now() + 15 * 60 * 1000),
      contentType: 'application/pdf',
      contentDisposition: `attachment; filename="${downloadNameOf(kind)}"`,
    })
    return { status: 302, headers: { location: url, 'cache-control': 'no-store' } }
  },
})

// PUT /api/framework-file/{kind}  raw PDF bytes → { ok: true, size } — the
// update path when a new edition of either document is adopted (blob
// overwrite; the framework text/versions in data/framework.ts are updated in
// code alongside it).
api({
  name: 'framework-file-put',
  methods: ['PUT'],
  route: 'framework-file/{kind}',
  handler: async (req) => {
    const kind = requireKind(req)
    const bytes = Buffer.from(await req.arrayBuffer())
    if (bytes.length === 0) throw new HttpError(400, 'empty upload body')
    await uploadsContainer()
      .getBlockBlobClient(`framework/${kind}.pdf`)
      .uploadData(bytes, { blobHTTPHeaders: { blobContentType: 'application/pdf' } })
    return ok({ ok: true, size: bytes.length }, 201)
  },
})
