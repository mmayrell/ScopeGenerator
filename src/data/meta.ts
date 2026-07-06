// Static UI/system metadata — not seed data. The app imports this at runtime;
// src/data/seed.ts stays reserved for the backend seed export. Framework
// names/versions mirror the fixed documents in api/src/data/framework.ts.
import type { Lesson, SystemArtifact } from '../types'

export const systemArtifacts: SystemArtifact[] = [
  { id: 'sys-engine', kind: 'engine', name: 'Lesson Granularity & Modeling Scope (v2 for ANY standard set)', version: 'v2', published: '2026-07-06', note: 'Fixed with the tool. Split, don’t-split, and modeling-scope rules for any standard set.' },
  { id: 'sys-doctrine', kind: 'doctrine', name: 'Direct Instruction BrainLift (Stein et al. 2017)', version: 'v1.8', published: '2026-04-19', note: 'Controlling method authority. Stein-priority encoded in all doctrine prompts.' },
]

export const fieldMeta: { key: keyof Lesson['fields']; n: number; label: string; purpose: string }[] = [
  { key: 'standards', n: 1, label: 'Standard', purpose: 'The official standard this atom is aligned to' },
  { key: 'cluster', n: 2, label: 'Cluster', purpose: 'Keeps the standard in context' },
  { key: 'objectives', n: 3, label: 'Objectives', purpose: 'The minimal-complete set of observable objectives that define mastery of this atom' },
  { key: 'emphasis', n: 4, label: 'Major / Supporting', purpose: 'Determines instructional weight in sequencing' },
  { key: 'progression', n: 5, label: 'Progression Placement', purpose: 'Situates the atom in the vertical story' },
  { key: 'prerequisites', n: 6, label: 'Prerequisites', purpose: 'What must already be secure before this lesson' },
  { key: 'boundary', n: 7, label: 'Assessment Boundary', purpose: 'The atom’s edges' },
  { key: 'newLearning', n: 8, label: 'New Learning', purpose: 'The one thing this lesson teaches' },
  { key: 'approach', n: 9, label: 'Instructional Approach', purpose: 'How students are taught to do the problems' },
  { key: 'nonGoals', n: 10, label: 'Non-Goals', purpose: 'Drift protection — what not to accidentally teach yet' },
  { key: 'ceiling', n: 11, label: 'Difficulty Ceiling', purpose: 'What “hard” can look like without leaving the grade' },
  { key: 'assessment', n: 12, label: 'Assessment Evidence', purpose: 'What mastery looks like' },
  { key: 'releasedItems', n: 13, label: 'Released Items (If Applicable)', purpose: 'The empirical anchors — shown, not cited' },
]
