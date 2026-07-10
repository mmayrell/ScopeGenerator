import { getJsonOrUndefined, putJson } from '../data/blobs'
import { dataContainer } from '../data/clients'

// The rubric spreadsheet behind Scope Evaluations. The sheet itself is the
// rubric source of truth: headers are fetched (public CSV export) at
// evaluation time, so editing a rubric in Google retunes the agent without a
// deploy. Writes go through a user-provided Apps Script webhook (Google's
// API requires OAuth for writes; a bound Apps Script web app is the
// zero-secret bridge) — its URL lives in evals/config.json.

export const EVAL_SHEET_ID = '1HYeLKwtRv-PujoNowQ0CqMMUTfdazvhYXfKt2_IX-9w'
export const EVAL_SHEET_GID = '0'
export const EVAL_SHEET_URL = `https://docs.google.com/spreadsheets/d/${EVAL_SHEET_ID}/edit?gid=${EVAL_SHEET_GID}#gid=${EVAL_SHEET_GID}`
const CSV_URL = `https://docs.google.com/spreadsheets/d/${EVAL_SHEET_ID}/export?format=csv&gid=${EVAL_SHEET_GID}`

/** How many trailing columns belong to the human SME — always left blank. */
export const SME_COLUMN_COUNT = 3

export interface EvalSheetColumn {
  index: number
  /** Group band from header row 1 (e.g. 'Lesson-Specific Fields'), inherited rightward. */
  group: string
  /** The heading's first line, ** markers stripped (e.g. 'New Learning'). */
  heading: string
  /** The full header cell — the rubric text the agent scores against. */
  rubric: string
  /** Bold (**…**) headings are the sheet's hard-gate convention. */
  hardGate: boolean
  role: 'admin' | 'rubric' | 'results' | 'sme'
}

export interface EvalSheetModel {
  columns: EvalSheetColumn[]
  rubricColumns: EvalSheetColumn[]
  /** The Automatic Verdict column's own rubric (the verdict formula lives in the sheet). */
  verdictRubric: string
}

/** Minimal CSV parser (RFC 4180 quoting) — the export uses quoted multi-line header cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cell += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      rows.push(row)
      row = []
    } else {
      cell += ch
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

const headingOf = (rubric: string): { heading: string; hardGate: boolean } => {
  const first = (rubric.split('\n')[0] ?? '').trim()
  const hardGate = /\*\*.+\*\*/.test(first)
  return { heading: first.replace(/\*+/g, '').trim(), hardGate }
}

/**
 * Fetch and model the sheet's two header rows. Throws when the sheet is
 * unreachable — an evaluation without rubrics is meaningless, and the queue
 * retries transient failures.
 */
export async function fetchEvalSheetModel(): Promise<EvalSheetModel> {
  const res = await fetch(CSV_URL, { redirect: 'follow', signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`rubric sheet CSV export returned ${res.status}`)
  const rows = parseCsv(await res.text())
  if (rows.length < 2) throw new Error('rubric sheet has no header rows')
  const groups = rows[0]
  const heads = rows[1]
  const columns: EvalSheetColumn[] = []
  let group = ''
  for (let i = 0; i < heads.length; i++) {
    if ((groups[i] ?? '').trim()) group = (groups[i] ?? '').trim()
    const rubric = heads[i] ?? ''
    const { heading, hardGate } = headingOf(rubric)
    columns.push({ index: i, group, heading, rubric, hardGate, role: 'rubric' })
  }
  // The scopeId parked in a far data column widens Google's CSV export to the
  // sheet's full grid, padding the header rows with empty cells. Trailing
  // heading-less columns are NOT part of the model — without this trim the
  // "last three columns are the SME's" rule slides off the real SME columns
  // and 'SME Verdict'/'SME Notes' start matching the results patterns.
  while (columns.length > 0 && columns[columns.length - 1].rubric.trim() === '') columns.pop()
  if (columns.length <= SME_COLUMN_COUNT) throw new Error('rubric sheet header row has too few headed columns')
  // Roles: trailing SME columns are the human's; the Results band computes
  // programmatically; short-headed leading columns are administrative.
  const n = columns.length
  for (const c of columns) {
    if (c.index >= n - SME_COLUMN_COUNT) c.role = 'sme'
    else if (/^results$/i.test(c.group)) c.role = 'results'
    else if (c.rubric.trim().length < 60) c.role = 'admin'
  }
  const verdictRubric = columns.find((c) => /automatic verdict/i.test(c.heading))?.rubric ?? ''
  return { columns, rubricColumns: columns.filter((c) => c.role === 'rubric'), verdictRubric }
}

// ---------------------------------------------------------------------------
// Webhook config + row push
// ---------------------------------------------------------------------------

const CONFIG_PATH = 'evals/config.json'

export interface EvalConfig {
  /** Apps Script web-app URL rows are POSTed to; '' = not connected yet. */
  webhookUrl: string
}

export async function getEvalConfig(): Promise<EvalConfig> {
  return (await getJsonOrUndefined<EvalConfig>(dataContainer(), CONFIG_PATH)) ?? { webhookUrl: '' }
}

export async function saveEvalConfig(config: EvalConfig): Promise<void> {
  await putJson(dataContainer(), CONFIG_PATH, config)
}

/**
 * Push one row to the sheet through the Apps Script webhook. The script
 * upserts by scopeId (kept in a far column outside the visible rubric), so
 * re-evaluations update their row instead of duplicating it. `values` must
 * already EXCLUDE the trailing SME columns — the script writes exactly
 * values.length cells, and a full-width write would wipe the human's entries
 * on every upsert.
 */
export async function pushEvalRow(webhookUrl: string, scopeId: string, values: string[]): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scopeId, values }),
    redirect: 'follow', // Apps Script replies via a 302 to script.googleusercontent.com
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`sheet webhook returned ${res.status}`)
  const text = await res.text()
  // STRICT success check: the reference script answers {"ok":true}. Anything
  // else — most commonly Google's sign-in HTML when the web app was deployed
  // with the wrong access setting — is a failed write, however 200 it looks.
  try {
    const parsed = JSON.parse(text) as { ok?: unknown; error?: unknown }
    if (parsed.ok !== true) {
      throw new Error(`sheet webhook reported: ${String(parsed.error ?? text.slice(0, 160))}`)
    }
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error(
        'sheet webhook did not answer with the script\'s JSON — check the Apps Script deployment (Execute as Me, access: Anyone)',
      )
    }
    throw e
  }
}
