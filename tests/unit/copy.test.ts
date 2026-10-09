import { describe, expect, it } from 'vitest';
import { messages } from '../../src/i18n';

// Tone rules (TECH_SPEC NFR-11): neutral and kind. No shouting, no shaming, no scoring, no blame.
const BANNED: [RegExp, string][] = [
  [/!/, 'exclamation marks'],
  [/\b(fail(ed|ure|s)?|wrong|bad|cheat\w*|guilt\w*|lazy|slack\w*|oops|sorry|unfortunately|illegal)\b/i, 'blaming or alarming words'],
  [/\b(streak\w*|overeat\w*|over budget|over your|under your|behind|ahead|on track|off track|good job|great job|well done|congrat\w*|keep it up|no excuses)\b/i, 'scoring, streaks or praise/pressure'],
  [/\b(obese|obesity|overweight|underweight|skinny|diet|BMI)\b/i, 'weight labels'],
  [/\byou (must|have to|need to|should|always|never)\b/i, 'commands'],
  [/\bplease\b/i, 'filler politeness (say what to do instead)'],
];

describe('copy tone', () => {
  const entries = Object.entries(messages);
  it('has strings to check', () => expect(entries.length).toBeGreaterThan(400));
  for (const [re, label] of BANNED) {
    it(`no ${label}`, () => {
      const hits = entries.filter(([, v]) => re.test(v)).map(([k, v]) => `${k}: ${v}`);
      expect(hits).toEqual([]);
    });
  }
  it('error and hint texts say what to do (end like a sentence)', () => {
    const texts = entries.filter(([k]) => /(\.error|Error|\.invalid|failed|noMatch|empty)$/.test(k));
    expect(texts.length).toBeGreaterThan(10);
    for (const [k, v] of texts) expect(v, k).toMatch(/[.…?:]$/);
  });
  it('no string is empty or has leading/trailing spaces, and placeholders are well-formed', () => {
    for (const [k, v] of entries) {
      expect(v.length, k).toBeGreaterThan(0);
      expect(v, k).toBe(v.trim());
      expect((v.match(/\{/g) ?? []).length, k).toBe((v.match(/\}/g) ?? []).length);
    }
  });
});
