// The Training notes and Nutrition notes cards of the review: a short written paragraph, one option for what comes next, and where the text came from.
// Text goes through textContent only (a note is plain text from Claude or from the server's rules, never HTML).
import type { ReviewNote } from '../../src/analytics/reviewTypes';
import { h, type Child } from './dom';
import { heading } from './blocks';

/** The card's content: the hidden heading, the note, "Next week" with its line, and the provenance line (with the ask line for an automatic note). */
export function notesCard(name: string, note: ReviewNote, period: 'week' | 'month'): Child[] {
  const noun = period === 'month' ? 'month' : 'week';
  return [
    heading(name),
    h('p', { className: 'note' }, note.text),
    note.next && h('div', { className: 'nline' }, h('span', { className: 'lab' }, period === 'month' ? 'Next 4 weeks' : 'Next week'), h('p', {}, note.next)),
    h('div', { className: 'nline' }, h('span', { className: 'lab' }, note.source === 'claude' ? `Written by Claude from your ${noun}` : 'Auto summary from your logs'), note.source === 'auto' && h('span', { className: 'lab' }, `Ask Claude for a written review of this ${noun}.`)),
  ];
}
