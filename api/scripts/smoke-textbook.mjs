// One-off smoke check for the textbook access layer (run: node scripts/smoke-textbook.mjs after tsc).
// Deliberately tiny and dependency-free; deleted or kept as a dev utility.
const { textbookIndex, chapterProcedures, pagesAround, appendixAFor, sectionText } = await import(
  '../dist/src/services/textbook.js'
)

const idx = textbookIndex()
console.log('index sections:', idx?.sections.length)

const proc7 = chapterProcedures(7, 40_000)
console.log('ch7 procedures chars:', proc7.length, '| has assessment chart:', /INSTRUCTIONAL SEQUENCE AND ASSESSMENT/i.test(proc7), '| stops before Format 7.1:', !/^Format 7\.1\b/m.test(proc7))
console.log('ch7 has diagnosis/remediation:', /remediation/i.test(proc7))

const around = pagesAround(7, [111], 1, 20_000)
console.log('pagesAround ch7 p111 chars:', around.length, '| pages present:', [...around.matchAll(/\[p\.(\d+)\]/g)].map((m) => m[1]).join(','))

const appA = appendixAFor('4.NBT.B.5', 8_000)
console.log('appendix A 4.NBT.B.5 chars:', appA.length)
console.log(appA.slice(0, 400))

const appA2 = appendixAFor('CCSS.MATH.CONTENT.6.RP.A.3', 8_000)
console.log('appendix A 6.RP.A.3 chars:', appA2.length)

console.log('division ch10 text chars:', sectionText('chapter-10').length)
