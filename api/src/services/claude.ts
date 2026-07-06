import Anthropic from '@anthropic-ai/sdk'

/**
 * Claude integration (contract §Claude integration).
 *
 * Rules encoded here (current API — do not "fix" from older priors):
 * - model from CLAUDE_MODEL, default 'claude-fable-5'
 * - NEVER set temperature/top_p/top_k (HTTP 400 on current models)
 * - Fable models: OMIT the `thinking` parameter entirely (an explicit
 *   disabled/enabled config 400s) and use the beta endpoint with server-side
 *   refusal fallbacks so a safety-classifier decline transparently re-runs on
 *   Opus 4.8: betas ['server-side-fallback-2026-06-01'],
 *   fallbacks [{ model: 'claude-opus-4-8' }]
 * - non-Fable models: plain messages.stream with thinking { type: 'adaptive' }
 * - always stream + await finalMessage() (calls can run minutes)
 * - structured output via output_config { format: { type: 'json_schema', schema }, effort }
 * - stop_reason 'refusal' → descriptive error; 'max_tokens' → truncation error;
 *   else concatenate text blocks and JSON.parse (one retry with the parse error
 *   appended to the user message)
 * - PDFs as base64 document blocks placed BEFORE the text block
 * - webSearch: server-side web_search tool; always unconstrained (server tools
 *   and constrained decoding do not compose) with pause_turn resumption
 */
export interface GenerateStructuredOptions {
  system: string
  user: string
  schema: Record<string, unknown>
  maxTokens?: number
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** base64-encoded PDFs (no newlines), placed before the text block */
  documents?: string[]
  /**
   * Give the model the server-side web_search tool. Web-search calls always
   * run UNCONSTRAINED (schema embedded in the prompt, JSON extracted from the
   * text) — server tools and constrained decoding do not compose — and handle
   * `pause_turn` by resuming the turn.
   */
  webSearch?: boolean
  /** Max server-side searches per call (webSearch only; default 8). */
  maxSearches?: number
}

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/** CLAUDE_EFFORT, when set to a valid level, forces a single effort for ALL calls (ops override). */
function resolveEffort(requested: GenerateStructuredOptions['effort']): string {
  const env = process.env.CLAUDE_EFFORT
  if (env && (EFFORT_LEVELS as readonly string[]).includes(env)) return env
  return requested ?? 'high'
}

interface MinimalMessage {
  stop_reason: string | null
  content: { type: string; text?: string }[]
  stop_details?: { category?: string | null; explanation?: string | null } | null
}

/** Large schemas can exceed the API's constrained-decoding grammar limit (a 400). */
function isGrammarTooLarge(e: unknown): boolean {
  return /compiled grammar is too large/i.test(e instanceof Error ? e.message : String(e))
}

/** Unconstrained replies may wrap the JSON in prose or code fences — cut to the outermost object. */
function extractJson(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start >= 0 && end > start ? text.slice(start, end + 1) : text
}

// Current web-search variant first (web_search_20260209, dynamic filtering —
// GA on Opus 4.8/4.7/4.6 and Sonnet 5/4.6, undocumented for Fable); if the
// model 400s on it, drop to the basic web_search_20250305 and remember.
const WEB_SEARCH_VARIANTS = ['web_search_20260209', 'web_search_20250305'] as const
let webSearchVariant = 0

function isUnsupportedWebSearchVariant(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  const status = (e as { status?: number }).status
  return status === 400 && /web_search/i.test(msg)
}

export async function generateStructured<T>(opts: GenerateStructuredOptions): Promise<T> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured')
  // 6 retries with the SDK's exponential backoff (~0.5s -> 30s+) rides out
  // transient 429/529 capacity windows that the default 2 quick retries burn
  // straight through (extraction died on exactly that: 'Overloaded' on every
  // attempt within one window).
  const client = new Anthropic({ apiKey, maxRetries: 6 })
  const model = process.env.CLAUDE_MODEL ?? 'claude-fable-5'

  let constrained = !opts.webSearch
  // Per-call variant ladder starting at the shared hint: the guard must judge
  // THIS call's variant, not the shared counter — with N concurrent first
  // calls all 400ing, a shared-counter guard lets only one of them retry.
  let variant = webSearchVariant
  let parseError: string | undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    let text: string
    try {
      text = await callOnce(client, model, opts, parseError, constrained, variant)
    } catch (e) {
      if (constrained && isGrammarTooLarge(e)) {
        // Fall back to an unconstrained call with the schema embedded in the
        // prompt; the parse below still validates the shape structurally.
        constrained = false
        continue
      }
      if (opts.webSearch && variant < WEB_SEARCH_VARIANTS.length - 1 && isUnsupportedWebSearchVariant(e)) {
        variant++
        webSearchVariant = Math.max(webSearchVariant, variant)
        continue
      }
      throw e
    }
    try {
      return JSON.parse(constrained ? text : extractJson(text)) as T
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e)
    }
  }
  throw new Error(`Claude returned output that could not be parsed as JSON after a retry: ${parseError}`)
}

async function callOnce(
  client: Anthropic,
  model: string,
  opts: GenerateStructuredOptions,
  parseError: string | undefined,
  constrained: boolean,
  webSearchVariantIndex = webSearchVariant,
): Promise<string> {
  let userText = parseError
    ? `${opts.user}\n\nIMPORTANT: your previous reply failed JSON.parse with the error: ${parseError}. Respond again with a single valid JSON object matching the schema exactly — no prose, no code fences.`
    : opts.user
  if (!constrained) {
    userText += `\n\nRespond with ONLY a single JSON object (no prose, no code fences) that validates against this JSON Schema:\n${JSON.stringify(opts.schema)}`
  }

  const content: unknown[] = []
  for (const data of opts.documents ?? []) {
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data },
    })
  }
  content.push({ type: 'text', text: userText })

  const messages: { role: 'user' | 'assistant'; content: unknown }[] = [{ role: 'user', content }]

  // Never set temperature/top_p/top_k here — current models reject them with a 400.
  const request: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? 64000,
    system: opts.system,
    messages,
    output_config: constrained
      ? {
          format: { type: 'json_schema', schema: opts.schema },
          effort: resolveEffort(opts.effort),
        }
      : { effort: resolveEffort(opts.effort) },
  }
  if (opts.webSearch) {
    request.tools = [
      { type: WEB_SEARCH_VARIANTS[webSearchVariantIndex], name: 'web_search', max_uses: opts.maxSearches ?? 8 },
    ]
  }

  // The SDK's parameter types evolve with the API (output_config, fallbacks,
  // betas); the wire shapes below follow the current API reference, so the
  // request objects are cast at the call site.
  // Long server-tool turns (web search) can stop with `pause_turn`; the turn
  // resumes by sending the paused assistant content back verbatim.
  let message: MinimalMessage
  for (let resume = 0; ; resume++) {
    if (model.startsWith('claude-fable')) {
      // Fable: thinking is always on — the `thinking` parameter is OMITTED entirely
      // (an explicit disabled/enabled config returns a 400).
      const stream = client.beta.messages.stream({
        ...request,
        betas: ['server-side-fallback-2026-06-01'],
        fallbacks: [{ model: 'claude-opus-4-8' }],
      } as never)
      message = (await stream.finalMessage()) as unknown as MinimalMessage
    } else {
      const stream = client.messages.stream({
        ...request,
        thinking: { type: 'adaptive' },
      } as never)
      message = (await stream.finalMessage()) as unknown as MinimalMessage
    }
    if (message.stop_reason !== 'pause_turn' || resume >= 3) break
    messages.push({ role: 'assistant', content: message.content })
  }

  if (message.stop_reason === 'refusal') {
    const category = message.stop_details?.category
    throw new Error(
      `Claude declined this request (stop_reason: refusal${category ? `, category: ${category}` : ''}); the request and its server-side fallback were both refused. Rephrase the evidence or retry with a smaller scope.`,
    )
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error('Claude output was truncated (max_tokens reached) — retry with a smaller scope.')
  }

  return message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
}
