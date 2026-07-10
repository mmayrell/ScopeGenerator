// Word export for a video script — the production contract on paper: every
// line channel-tagged and channel-colored (playbook §3), interactions as
// structured blocks with their full feedback ladders. Loaded lazily so the
// docx library stays out of the main bundle.
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import type { VideoScript, VsgChannel, VsgInteraction } from '../types'

const INK = '23232B'
const INK2 = '5A5A66'
const ACCENT = '3F3FA8'

// Playbook §3: the channel owns its color everywhere — viewer and exports.
const CHANNEL_COLORS: Record<VsgChannel, string> = {
  SAY: '000000',
  TEXT: '1D4ED8',
  VISUAL: '15803D',
  INTERACTION: '7E22CE',
  NOTE: '6B7280',
}

// XML 1.0 forbids C0 control characters — docx does not filter them. Built via
// RegExp() so no literal control bytes live in this source file.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]', 'g')
const xmlSafe = (text: string): string => text.replace(CONTROL_CHARS, ' ')

interface RunOpts {
  size?: number
  color?: string
  bold?: boolean
  italics?: boolean
}

const textRuns = (text: string, opts?: RunOpts): TextRun[] =>
  xmlSafe(text)
    .split('\n')
    .map(
      (line, i) =>
        new TextRun({
          text: line,
          break: i > 0 ? 1 : undefined,
          size: opts?.size ?? 21,
          color: opts?.color ?? INK,
          bold: opts?.bold,
          italics: opts?.italics,
        }),
    )

const para = (text: string, opts?: RunOpts & { before?: number; after?: number; indent?: number }): Paragraph =>
  new Paragraph({
    spacing: { before: opts?.before ?? 0, after: opts?.after ?? 60 },
    indent: opts?.indent ? { left: opts.indent } : undefined,
    children: textRuns(text, opts),
  })

/** A channel-tagged script line: time stamp, bold colored [TAG], then the content in the channel color. */
const channelLine = (channel: VsgChannel, content: string, time?: string, indent = 0): Paragraph =>
  new Paragraph({
    spacing: { after: 50 },
    indent: indent ? { left: indent } : undefined,
    children: [
      ...(time ? [new TextRun({ text: `${time}  `, size: 16, color: INK2 })] : []),
      new TextRun({ text: `[${channel}] `, bold: true, size: 18, color: CHANNEL_COLORS[channel] }),
      ...textRuns(content, {
        size: 21,
        color: CHANNEL_COLORS[channel],
        italics: channel === 'NOTE',
      }),
    ],
  })

const SEGMENT_LABELS: Record<string, string> = {
  title: 'TITLE',
  intro: 'INTRO',
  'i-do': 'I DO',
  'we-do': 'WE DO',
  wrap: 'WRAP',
}

function interactionParas(interaction: VsgInteraction): Paragraph[] {
  const purple = CHANNEL_COLORS.INTERACTION
  const out: Paragraph[] = [
    para(`Type: ${interaction.type} · Prompt: ${interaction.prompt}`, { color: purple, bold: true, indent: 480 }),
  ]
  interaction.options.forEach((opt, i) => {
    out.push(para(`${String.fromCharCode(65 + i)}. ${opt}`, { color: INK, indent: 720 }))
  })
  out.push(
    para(`Answer: ${interaction.answer}`, { color: INK, indent: 720 }),
    para(`Correct: ${interaction.correctFeedback}`, { color: INK2, indent: 720 }),
    para(`Try 1: ${interaction.try1Hint}`, { color: INK2, indent: 720 }),
    para(`Try 2: ${interaction.try2ShowAndMoveOn}`, { color: INK2, indent: 720 }),
    para(`Resume: ${interaction.resumeState}`, { color: INK2, indent: 720 }),
    para(`Show model: ${interaction.modelAccess ? 'available' : 'not offered'} — ${interaction.modelAccessNote}`, {
      color: INK2,
      indent: 720,
    }),
  )
  return out
}

/** One script's full paragraph sequence; `pageBreak` starts it on a fresh page (multi-script docs). */
function scriptChildren(script: VideoScript, pageBreak = false): Paragraph[] {
  const children: Paragraph[] = []

  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: pageBreak,
      spacing: { after: 80 },
      children: [new TextRun({ text: xmlSafe(`Video Script — ${script.lessonTitle}`), bold: true, color: ACCENT })],
    }),
    para(
      `${script.unitName} · ${script.standardId} · grade band ${script.gradeBand} · ${script.durationEstimate} · ${script.interactionCount} interactions`,
      { color: INK2 },
    ),
    para(`${script.playbookVersion} · ${script.doctrineVersion} · script v${script.version} · generated ${script.created.slice(0, 10)}`, {
      color: INK2,
      size: 18,
    }),
  )
  if (script.formatRefs.length > 0) {
    children.push(para(`Stein formats followed: ${script.formatRefs.join(' · ')}`, { color: INK2, size: 18 }))
  }
  for (const c of script.conflictsResolved) {
    children.push(
      para(
        `Reconciled conflict (${c.kind}): ${c.summary} — A: ${c.sideA} — B: ${c.sideB} — resolution (${c.resolvedBy ?? 'default'}): ${c.resolution ?? ''}`,
        { color: INK2, size: 18, italics: true },
      ),
    )
  }
  if (script.qa.hardFails.length > 0) {
    children.push(para(`UNRESOLVED HARD QA FAILURES: ${script.qa.hardFails.join(' · ')}`, { color: 'B00020', bold: true }))
  }
  if (script.qa.flags.length > 0) {
    children.push(para(`Review flags: ${script.qa.flags.join(' · ')}`, { color: INK2, size: 18, italics: true }))
  }

  for (const seg of script.segments) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 60 },
        children: [
          new TextRun({
            text: xmlSafe(`${SEGMENT_LABELS[seg.kind] ?? seg.kind} · ${seg.start}–${seg.end} · ${seg.purpose}`),
            bold: true,
            color: INK,
          }),
        ],
      }),
    )
    for (const line of seg.lines) {
      children.push(channelLine(line.channel, line.content, line.time))
      if (line.interaction) children.push(...interactionParas(line.interaction))
    }
  }
  return children
}

const toDoc = (children: Paragraph[]): Promise<Blob> =>
  Packer.toBlob(
    new Document({
      styles: { default: { document: { run: { font: 'Calibri' } } } },
      sections: [{ children }],
    }),
  )

export async function buildScriptDocxBlob(script: VideoScript): Promise<Blob> {
  return toDoc(scriptChildren(script))
}

/** Every script of a run in ONE document — cover page, then one script per page break, in lesson order. */
export async function buildAllScriptsDocxBlob(courseName: string, scripts: VideoScript[]): Promise<Blob> {
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 80 },
      children: [new TextRun({ text: xmlSafe(`Video Scripts — ${courseName}`), bold: true, color: ACCENT })],
    }),
    para(`${scripts.length} script${scripts.length === 1 ? '' : 's'} · exported ${new Date().toISOString().slice(0, 10)}`, {
      color: INK2,
    }),
    ...scripts.map((s, i) => para(`${i + 1}. ${s.lessonTitle} (${s.unitName} · ${s.durationEstimate || '—'})`, { color: INK, size: 20 })),
  ]
  for (const s of scripts) children.push(...scriptChildren(s, true))
  return toDoc(children)
}

const triggerDownload = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function downloadScriptDocx(script: VideoScript): Promise<void> {
  triggerDownload(
    await buildScriptDocxBlob(script),
    `${script.lessonTitle.replace(/[^\w\- ]+/g, '').trim() || 'video-script'} — Video Script.docx`,
  )
}

export async function downloadAllScriptsDocx(courseName: string, scripts: VideoScript[]): Promise<void> {
  triggerDownload(
    await buildAllScriptsDocxBlob(courseName, scripts),
    `${courseName.replace(/[^\w\- ]+/g, '').trim() || 'course'} — All Video Scripts.docx`,
  )
}
