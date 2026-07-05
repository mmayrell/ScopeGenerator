import { app, HttpMethod, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { ensureInfra } from '../data/clients'
import { HttpError } from './errors'

type Handler = (req: HttpRequest, ctx: InvocationContext) => Promise<HttpResponseInit>

/**
 * Registers an HTTP function with the access-code middleware (contract
 * §Authentication): every endpoint except GET /api/health requires
 * `x-access-code: <APP_ACCESS_CODE>`; wrong/missing → 401 {"error":"unauthorized"}.
 * Non-2xx responses are `{ error: string }`.
 */
export function api(options: {
  name: string
  methods: HttpMethod[]
  route: string
  handler: Handler
  auth?: boolean
}): void {
  const requiresAuth = options.auth !== false
  app.http(options.name, {
    methods: options.methods,
    route: options.route,
    authLevel: 'anonymous',
    handler: async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
      try {
        if (requiresAuth) {
          const expected = process.env.APP_ACCESS_CODE
          if (!expected || req.headers.get('x-access-code') !== expected) {
            return { status: 401, jsonBody: { error: 'unauthorized' } }
          }
          await ensureInfra()
        }
        return await options.handler(req, ctx)
      } catch (e) {
        if (e instanceof HttpError) {
          return { status: e.status, jsonBody: { error: e.message } }
        }
        ctx.error(`${options.name} failed:`, e)
        return { status: 500, jsonBody: { error: e instanceof Error ? e.message : String(e) } }
      }
    },
  })
}

export async function readJson<T>(req: HttpRequest): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    throw new HttpError(400, 'request body must be valid JSON')
  }
}

export function ok(body: unknown, status = 200): HttpResponseInit {
  return { status, jsonBody: body }
}

export function requireParam(req: HttpRequest, name: string): string {
  const value = req.params[name]
  if (!value) throw new HttpError(400, `missing route parameter: ${name}`)
  return value
}
