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
  const barbell = has(n, /barbell|\bez\b|ez-bar|smith|bar\b|axle|olympic/);
  const kettlebell = has(n, /kettlebell/);
  const dumbbell = has(n, /dumbbell|goblet|\bdb\b/);
  const weight: Hold | undefined = barbell ? 'barbell' : kettlebell ? 'kettlebell' : dumbbell ? 'dumbbell' : undefined;

  // Cable stations we can draw, checked before the general "no cables or machines" rule below.
  if (has(n, /pushdown|push-down|press-?down/) && !has(n, /incline|reverse|pulldown|kneeling/)) return { id: 'triceps-pushdown' };
  if (has(n, /lat pulldown|pulldown/) && !has(n, /straight|rope|behind|one arm|rocky|kneeling/)) return { id: 'lat-pulldown' };
  if (has(n, /straight-arm pulldown/) && !has(n, /rope/)) return { id: 'straight-arm-pulldown' };
  if (has(n, /seated cable rows?|seated one-arm cable pulley rows?|elevated cable rows?/)) return { id: 'seated-cable-row' };
  if (has(n, /^face pull/)) return { id: 'face-pull' };
  if (has(n, /^standing (biceps |one-arm )?cable curl/)) return { id: 'curl', hold: 'cable-low' };

  // Machines, other cables, plyometrics and odd variations do not look like the plain movement: draw nothing rather than something wrong.
  const odd = has(n, /leverage|rope|pulley|sled|halo|towel|finger|lower back|depth|plyo|clock|bradford|frankenstein|suspended|cable|machine|one[- ]leg|single[- ]leg|to side|seated good|hanging bar|rocky|band|chain|kneeling (jump )?squat|lying cambered|lying t-bar|physioball|exercise ball|bosu|stability ball|-smr|wall/);
  if (odd) return undefined;

  // Stretches and mobility.
  if (has(n, /^(standing )?toe touch/)) return { id: 'toe-touch' };
  if (has(n, /^seated (floor )?hamstring( stretch)?$|seated hamstring and calf/)) return { id: 'seated-hamstring-stretch' };
  if (has(n, /^(quad stretch|standing elevated quad stretch)$/)) return { id: 'quad-stretch' };
  if (has(n, /knees? to chest/)) return { id: 'knee-to-chest' };
  if (has(n, /child's pose/)) return { id: 'childs-pose' };
  if (has(n, /^front leg raises$/)) return { id: 'leg-swing' };
  if (has(n, /^arm circles$/)) return { id: 'arm-circles' };
  if (has(n, /^superman$/)) return { id: 'superman' };

  // Core.
  if (has(n, /\bplank\b/) && !has(n, /side|push|row|knee|up/)) return { id: 'plank' };
  if (has(n, /mountain climber/)) return { id: 'mountain-climber' };
  if (has(n, /dead bug/)) return { id: 'dead-bug' };
  if (has(n, /flutter kick/)) return { id: 'flutter-kick' };
  if (has(n, /ab roller|ab rollout/) && !has(n, /from bench/)) return { id: 'ab-rollout', hold: 'wheel' };
  if (has(n, /^reverse crunch/)) return { id: 'reverse-crunch' };
  if (has(n, /lying leg raise/)) return { id: 'lying-leg-raise' };
  if (has(n, /hanging pike|hanging (leg|knee) raise/)) return { id: 'hanging-leg-raise' };
  if (has(n, /knee\/hip raise on parallel bars|hanging knee/)) return { id: 'hanging-knee-raise' };
  if (has(n, /hyperextension|back extension/) && !has(n, /reverse|ball|no hyperextension/)) return { id: 'back-extension' };

  // Upper body pushing.
  if (has(n, /push[- ]?ups?\b|pushups\b/) && !has(n, /handstand|clap|pike|side plank/)) return { id: 'push-up' };
  if (has(n, /bench dip/)) return { id: 'bench-dip' };
  if (has(n, /\bdips?\b/) && !has(n, /jerk|squat/)) return { id: 'dip' };
  if (has(n, /incline .*(bench|dumbbell) (press|bench)|incline dumbbell press|incline db bench/) && !has(n, /fly|flye|cable|push-up/)) return { id: 'incline-press', hold: weight ?? 'barbell' };
  if (has(n, /bench press|floor press|chest press|dumbbell press with neutral/) && !has(n, /decline|incline|guillotine|reverse|board|jerk|anti-gravity/)) return { id: 'bench-press', hold: weight ?? 'barbell' };
  if (has(n, /push press/) && !has(n, /behind/)) return { id: 'push-press', hold: weight ?? 'barbell' };
  if (has(n, /thruster/)) return { id: 'thruster', hold: weight ?? 'barbell' };
  if (has(n, /seated .*(shoulder|military|dumbbell|kettlebell) press|kettlebell seated press/) && !has(n, /triceps?/)) return { id: 'seated-press', hold: weight ?? 'dumbbell' };
  if (has(n, /(shoulder|military|overhead|arnold|standing|seated) .*press|^(barbell|dumbbell|kettlebell) (shoulder|military)|military press/) && !has(n, /bench|leg|calf|tricep|behind|neck|see-saw|seesaw|bent press|jerk/)) return { id: 'overhead-press', hold: weight ?? 'dumbbell' };

  // Upper body pulling.
  if (has(n, /pull[- ]?ups?\b|chin[- ]?ups?\b|chinups?\b|pullups?\b/) && !has(n, /pull-?in|assisted|muscle|side to side|gironda|kipping/)) return { id: 'pull-up' };
  if (has(n, /inverted row/)) return { id: 'inverted-row' };
  if (has(n, /upright (barbell |dumbbell )?row|^(standing )?(dumbbell |barbell )?upright row/)) return { id: 'upright-row', hold: weight ?? 'barbell' };
  if (has(n, /\brows?\b/) && has(n, /bent|barbell|t-bar|dumbbell|kettlebell/) && !has(n, /upright|seated|incline|renegade|rear|reverse|lying|mid/)) return { id: 'row', hold: weight ?? 'barbell' };

  // Arms.
  if (has(n, /kickback/) && has(n, /tricep/)) return { id: 'kickback' };
  if (has(n, /bent-over .*triceps extension/)) return { id: 'kickback' };
  if (has(n, /skull ?crusher|lying triceps press|lying (dumbbell |close-grip barbell )?tricep(s)? extension|lying close-grip barbell triceps (extension|press)/) && !has(n, /decline/)) return { id: 'skull-crusher', hold: dumbbell ? 'dumbbell' : 'barbell' };
  if (has(n, /(triceps?).*(extension)|(overhead|french).*(extension|press)/) && !has(n, /kickback|lying|decline|incline|bench|close/)) return { id: 'triceps-extension', hold: weight ?? 'dumbbell' };
  if (has(n, /pullover/) && !has(n, /decline|front raise/)) return { id: 'pullover', hold: barbell ? 'barbell' : 'dumbbell' };
  if (has(n, /preacher/) && !has(n, /reverse/)) return { id: 'preacher-curl', hold: dumbbell ? 'dumbbell' : 'barbell' };
  if (has(n, /concentration/) && has(n, /curl/)) return { id: 'concentration-curl', hold: barbell ? 'barbell' : 'dumbbell' };
  if (has(n, /\bcurls?\b/) && !has(n, /leg|hamstring|wrist|nordic|ball|lying|incline|reverse|spider|drag|crossover|plate|high|overhead|back curl/)) return { id: 'curl', hold: barbell ? 'barbell' : 'dumbbell' };
  if (has(n, /(lateral|front|side|deltoid) raise|raise.*(lateral|side)|side laterals/) && !has(n, /calf|leg|hip|bent|lying|incline|rear|face|twist|pullover|plate|above head|over head/)) return { id: 'raise', hold: weight ?? 'dumbbell' };

  // Legs.
  if (has(n, /jump squat/)) return { id: 'jump-squat' };
  if (has(n, /tuck jump/)) return { id: 'tuck-jump' };
  if (has(n, /overhead squat/) && !has(n, /one-arm/)) return { id: 'overhead-squat', hold: 'barbell' };
  if (has(n, /squat/) && !has(n, /split|hack|pistol|get-up|jerk|lunge|sissy|thruster|jefferson|one leg|single|overhead/)) {
    if (has(n, /goblet|dumbbell|kettlebell|plie/)) return { id: 'squat-goblet', hold: kettlebell ? 'kettlebell' : 'dumbbell' };
    if (has(n, /front|zercher|clean grip/)) return { id: 'front-squat', hold: 'barbell' };
    if (barbell || has(n, /box|anderson|safety|olympic/)) return { id: 'squat-barbell', hold: 'barbell' };
    return { id: 'squat-bodyweight' };
  }
  if (has(n, /step[- ]?ups?\b/)) return { id: 'step-up' };
  if (has(n, /lunge|split squat/) && !has(n, /pass through|sprint|get-up|turkish|jump/)) return { id: 'lunge' };
  if (has(n, /\bclean\b/) && !has(n, /deadlift|pull|shrug|jerk|press|split|bottoms-up|blocks/)) return { id: 'clean', hold: weight ?? 'barbell' };
  if (has(n, /deadlift/) && !has(n, /car\b|rickshaw|axle|clean|cable/)) return has(n, /romanian|stiff|straight|one-legged|single/) ? { id: 'romanian-deadlift', hold: weight ?? 'barbell' } : { id: 'deadlift', hold: weight ?? 'barbell' };
  if (has(n, /good morning/)) return { id: 'good-morning', hold: 'barbell' };
  if (has(n, /swing/) && has(n, /kettlebell/) && !has(n, /sledge|vertical/)) return { id: 'kettlebell-swing', hold: 'kettlebell' };
  if (has(n, /hip thrust/)) return { id: 'hip-thrust', hold: 'barbell' };
  if (has(n, /glute bridge|hip bridge|butt lift|bridge/) && !has(n, /side|london|pelvic|ball|single|one|elevated/)) return { id: 'glute-bridge' };
  if (has(n, /glute kickback/)) return { id: 'glute-kickback' };
  if (has(n, /calf (raise|press)|calf-?raise|donkey calf/) && !has(n, /stretch|leg press|seated/)) return { id: 'calf-raise' };
  if (has(n, /farmer'?s walk/)) return { id: 'farmers-walk', hold: weight ?? 'dumbbell' };

  // Abs, last: plenty of other names contain "crunch" or "sit-up".
  if (has(n, /sit-?ups?\b/) && !has(n, /weighted|decline|ball|vertical|v-/)) return { id: 'sit-up' };
  if (has(n, /\bcrunch(es)?\b/) && !has(n, /reverse|oblique|bicycle|ball|decline|cross|legs|gorilla|kneeling|side|incline|toe|v-/)) return { id: 'crunch' };
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
