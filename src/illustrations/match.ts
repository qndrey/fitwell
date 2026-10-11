import type { Hold, Template } from './figure';
import { TEMPLATES } from './templates';

export interface Matched {
  id: string;
  template: Template;
}

const has = (s: string, re: RegExp) => re.test(s);

/** Which drawing fits an exercise, judged from its name. Only motions that really look alike are matched; the rest get none. */
export function templateIdFor(rawName: string): { id: string; hold?: Hold } | undefined {
  const n = rawName.toLowerCase();
  const barbell = has(n, /barbell|\bez\b|smith|bar\b|axle|olympic/);
  const dumbbell = has(n, /dumbbell|kettlebell|goblet/);
  // Machines, cables, plyometrics and odd variations do not look like the plain movement: draw nothing rather than something wrong.
  const odd = has(n, /leverage|rope|pulley|sled|halo|towel|finger|lower back|depth jump|plyo|clock|bradford|frankenstein|suspended|cable|machine|one[- ]leg|single[- ]leg|to side|seated good|hanging bar|rocky/);
  const weight: Hold | undefined = barbell ? 'barbell' : dumbbell ? 'dumbbell' : undefined;

  if (has(n, /pushdown|push-down|press-?down/) && !has(n, /incline|reverse|pulldown/)) return { id: 'triceps-pushdown' };
  if (odd) return undefined;
  if (has(n, /\bplank\b/) && !has(n, /side|push|row|knee|up/)) return { id: 'plank' };
  if (has(n, /push[- ]?ups?\b|pushups\b/) && !has(n, /handstand|clap|pike/)) return { id: 'push-up' };
  if (has(n, /pull[- ]?ups?\b|chin[- ]?ups?\b|chinups?\b|pullups?\b/) && !has(n, /pull-?in|band|assisted|machine/)) return { id: 'pull-up' };
  if (has(n, /hanging (leg|knee)|leg raise/) && has(n, /hanging/)) return { id: 'hanging-leg-raise' };
  if (has(n, /squat/) && !has(n, /split|hack|overhead|pistol|get-up|jerk|lunge|sissy|wall|machine|thruster|bulgarian|jefferson/)) {
    if (has(n, /goblet|dumbbell|kettlebell/)) return { id: 'squat-goblet' };
    if (barbell || has(n, /front|box|zercher|anderson|safety/)) return { id: 'squat-barbell', hold: 'barbell' };
    return { id: 'squat-bodyweight' };
  }
  if (has(n, /lunge|split squat|step[- ]?up/) && !has(n, /pass through|sprint|get-up|turkish|jump/)) return { id: 'lunge' };
  if (has(n, /deadlift/) && !has(n, /band|chain|car\b|rickshaw|axle|clean/)) return has(n, /romanian|stiff|straight|one-legged|single/) ? { id: 'romanian-deadlift' } : { id: 'deadlift', hold: weight ?? 'barbell' };
  if (has(n, /good morning/) && !has(n, /band/)) return { id: 'romanian-deadlift' };
  if (has(n, /swing/) && has(n, /kettlebell/) && !has(n, /sledge|vertical/)) return { id: 'kettlebell-swing' };
  if (has(n, /bench press|floor press|chest press/) && !has(n, /machine|cable|band|chain|decline|incline|guillotine|reverse|close|wide|board|powerlifting|jerk|smith/)) return { id: 'bench-press', hold: weight ?? 'barbell' };
  if (has(n, /(shoulder|military|overhead|arnold|standing|seated) .*press|^(barbell|dumbbell|kettlebell) (shoulder|military)/) && !has(n, /bench|cable|machine|band|leg|calf|tricep|behind|push press|neck/)) return { id: 'overhead-press', hold: weight ?? 'dumbbell' };
  if (has(n, /\brows?\b/) && has(n, /bent|barbell|t-bar|dumbbell/) && !has(n, /upright|cable|seated|incline|machine|renegade|rear|inverted|reverse/)) return { id: 'row', hold: weight ?? 'barbell' };
  if (has(n, /(triceps?|skull).*(extension|crusher)|(overhead|french).*(extension|press)/) && !has(n, /cable|machine|band|kickback|lying|decline|incline|bench|close/)) return { id: 'triceps-extension', hold: weight ?? 'dumbbell' };
  if (has(n, /\bcurls?\b/) && !has(n, /leg|hamstring|wrist|nordic|ball|preacher|concentration|lying|incline|machine|cable|band|reverse|spider|drag|crossover/)) return { id: 'curl', hold: barbell ? 'barbell' : 'dumbbell' };
  if (has(n, /(lateral|front|side) raise|raise.*(lateral|side)|deltoid raise/) && !has(n, /calf|leg|hip|cable|machine|bent|lying|incline|rear|band|face|reverse|twist|pullover/)) return { id: 'raise', hold: weight ?? 'dumbbell' };
  if (has(n, /calf (raise|press)|calf-?raise|donkey calf/) && !has(n, /stretch|machine|leg press|seated|band|dumbbell seated/)) return { id: 'calf-raise' };
  if (has(n, /sit-?ups?\b/) && !has(n, /machine|weighted|decline|cable|band|ball|vertical|v-/)) return { id: 'sit-up' };
  if (has(n, /\bcrunch(es)?\b/) && !has(n, /machine|cable|reverse|oblique|bicycle|ball|decline|bosu|cross|legs|gorilla|kneeling|side|incline|toe|v-/)) return { id: 'crunch' };
  if (has(n, /glute bridge|hip thrust|hip bridge|butt lift|bridge/) && !has(n, /side|london|pelvic|ball|single|one|bosu|wall|elevated|physioball|kettlebell|bar$/)) return { id: 'glute-bridge' };
  return undefined;
}

/** The drawing for an exercise name, or undefined when none fits. */
export function figureFor(name: string): Matched | undefined {
  const m = templateIdFor(name);
  if (!m) return undefined;
  const base = TEMPLATES[m.id];
  if (!base) return undefined;
  return { id: m.id, template: m.hold && base.hold ? { ...base, hold: m.hold } : base };
}
