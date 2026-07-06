import { LibraryFile, LibraryRole, PacketFramework } from '../domain/types'
import { uploadsContainer } from '../data/clients'
import { HttpError } from '../shared/errors'
import { api, ok, requireParam } from '../shared/http'

// Reference Library — the document repository behind the tool. The four
// document sets a standard set is built from (official standards, progression,
// released items, unpacking) are filed per framework and grade (3–8) and live
// as blobs under uploads/library/<framework>/<grade>/<role>/<fileName>.
// There is no index document: the listing derives from a prefix walk, so the
// library can never drift from what storage actually holds.

const FRAMEWORKS: PacketFramework[] = ['ccss', 'teks', 'sol', 'best']
const ROLES: LibraryRole[] = ['standards', 'progression', 'items', 'unpacking']
const LIBRARY_PREFIX = 'library/'

interface Slot {
  framework: PacketFramework
  grade: number
  role: LibraryRole
  fileName: string
}

/** Route params are caller input — validate every path segment before it becomes a blob path. */
function requireSlot(req: Parameters<Parameters<typeof api>[0]['handler']>[0]): Slot {
  const framework = requireParam(req, 'framework') as PacketFramework
  const grade = Math.trunc(Number(requireParam(req, 'grade')))
  const role = requireParam(req, 'role') as LibraryRole
  const fileName = requireParam(req, 'fileName')
  if (!FRAMEWORKS.includes(framework)) throw new HttpError(400, `framework must be one of: ${FRAMEWORKS.join(', ')}`)
  if (!Number.isFinite(grade) || grade < 3 || grade > 8) throw new HttpError(400, 'grade must be 3–8')
  if (!ROLES.includes(role)) throw new HttpError(400, `role must be one of: ${ROLES.join(', ')}`)
  if (!fileName || /[\\/]|\.\./.test(fileName)) throw new HttpError(400, 'invalid file name')
  return { framework, grade, role, fileName }
}

const blobPathOf = (s: Slot) => `${LIBRARY_PREFIX}${s.framework}/${s.grade}/${s.role}/${s.fileName}`

// GET /api/library → { files: LibraryFile[] } — the whole library in one walk
// (a few dozen PDFs at most; the frontend filters by framework/grade locally).
api({
  name: 'library-list',
  methods: ['GET'],
  route: 'library',
  handler: async () => {
    const files: LibraryFile[] = []
    for await (const blob of uploadsContainer().listBlobsFlat({ prefix: LIBRARY_PREFIX })) {
      const segments = blob.name.slice(LIBRARY_PREFIX.length).split('/')
      if (segments.length < 4) continue
      const [framework, gradeRaw, role, ...rest] = segments
      const grade = Number(gradeRaw)
      if (
        !FRAMEWORKS.includes(framework as PacketFramework) ||
        !ROLES.includes(role as LibraryRole) ||
        !Number.isInteger(grade)
      ) {
        continue // stray blob under the prefix — not part of the library
      }
      files.push({
        framework: framework as PacketFramework,
        grade,
        role: role as LibraryRole,
        fileName: rest.join('/'),
        size: blob.properties.contentLength ?? 0,
        updated: blob.properties.lastModified?.toISOString() ?? '',
      })
    }
    files.sort((a, b) => a.fileName.localeCompare(b.fileName))
    return ok({ files })
  },
})

// PUT /api/library/{framework}/{grade}/{role}/{fileName}  raw PDF bytes → { file: LibraryFile }
// Re-uploading the same name replaces the document (blob overwrite).
api({
  name: 'library-put',
  methods: ['PUT'],
  route: 'library/{framework}/{grade}/{role}/{fileName}',
  handler: async (req) => {
    const slot = requireSlot(req)
    const bytes = Buffer.from(await req.arrayBuffer())
    if (bytes.length === 0) throw new HttpError(400, 'empty upload body')
    await uploadsContainer()
      .getBlockBlobClient(blobPathOf(slot))
      .uploadData(bytes, { blobHTTPHeaders: { blobContentType: 'application/pdf' } })
    const file: LibraryFile = { ...slot, size: bytes.length, updated: new Date().toISOString() }
    return ok({ file }, 201)
  },
})

// DELETE /api/library/{framework}/{grade}/{role}/{fileName} → { ok: true }
api({
  name: 'library-delete',
  methods: ['DELETE'],
  route: 'library/{framework}/{grade}/{role}/{fileName}',
  handler: async (req) => {
    await uploadsContainer().getBlockBlobClient(blobPathOf(requireSlot(req))).deleteIfExists()
    return ok({ ok: true })
  },
})

// GET /api/library-file/{framework}/{grade}/{role}/{fileName} → the PDF —
// opened in a browser tab, which can't attach the x-access-code header, so
// this endpoint also accepts ?code= (mirrors item-image; auth:false skips the
// header middleware and the check runs manually).
api({
  name: 'library-file',
  methods: ['GET'],
  route: 'library-file/{framework}/{grade}/{role}/{fileName}',
  auth: false,
  handler: async (req) => {
    const expected = process.env.APP_ACCESS_CODE
    const supplied = req.headers.get('x-access-code') ?? req.query.get('code')
    if (!expected || supplied !== expected) {
      return { status: 401, jsonBody: { error: 'unauthorized' } }
    }
    const slot = requireSlot(req)
    const blob = uploadsContainer().getBlobClient(blobPathOf(slot))
    if (!(await blob.exists())) throw new HttpError(404, 'no such library document')
    const bytes = await blob.downloadToBuffer()
    return {
      status: 200,
      body: new Uint8Array(bytes),
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${slot.fileName.replace(/"/g, '')}"`,
        'cache-control': 'private, max-age=300',
      },
    }
  },
})
