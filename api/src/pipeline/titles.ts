import { Unit } from '../domain/types'

/**
 * Course-wide display-title uniqueness. The JSON export's lessonTitle (the
 * student-friendly title, falling back to the engineering title) is a
 * downstream IDENTITY key — the platform, the LSG registry, and the Lesson
 * Scope Edits picker all key lessons by (unitName, lessonTitle) or bare
 * title — and sibling card batches choose their student titles independently
 * (one Claude call cannot see another's picks), so collisions are possible.
 * On a case-insensitive collision the later lesson's student title falls
 * back to its engineering title, which the naming rules make unique by
 * construction. Runs on every path that writes lessons: generation finalize,
 * reruns, and proposal apply.
 */
export function dedupeStudentTitles(units: Unit[]): void {
  const seen = new Set<string>()
  const key = (t: string) => t.trim().toLowerCase()
  for (const u of units) {
    for (const l of u.lessons) {
      let display = (l.studentFriendlyTitle ?? '').trim() || l.title
      if (seen.has(key(display)) && display !== l.title) {
        l.studentFriendlyTitle = l.title
        display = l.title
      }
      seen.add(key(display))
    }
  }
}
