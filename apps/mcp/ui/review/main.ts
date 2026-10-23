import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { WeekReview } from '../../src/analytics/reviewTypes';
import { h, type Child } from '../shared/dom';
import { fmtDay, monthStrip, weekStrip } from '../shared/chart';
import { WORKOUT_KEY } from '../shared/chartMath';
import { createCardPager, type CardPager } from '../shared/cardPager';
import { caption, empty, heading, hrow, subhead, tint } from '../shared/blocks';
import { notesCard } from '../shared/notes';
import { addDays, CONFIDENCE_WORD, gain, mondayOf, monthTitle, shortName, weekTitle } from './copy';

type CardKey = 'week' | 'training-notes' | 'nutrition-notes' | 'food' | 'training' | 'body' | 'energy' | 'consider';
const state = { review: null as WeekReview | null, cardKey: 'week' as CardKey, loading: false, error: '' };
/** What the numbers are compared with, in the review's own words. */
const against = () => (state.review?.period === 'month' ? 'the 4 weeks before' : 'last week');
/** The Monday of the review's last week (the week itself, or the end of a month). */
const lastWeekOf = (r: WeekReview) => (r.period === 'month' ? addDays(r.weekStart, 21) : r.weekStart);
/** Cards that compare with the earlier period say so in the label row. */
const COMPARES: readonly CardKey[] = ['food', 'training', 'body'];

const root = document.getElementById('app')!;
const app = new App({ name: 'Fitwell weekly review', version: '0.1.0' }, {}, { autoResize: true });
let pager: CardPager | null = null;
/** What the live region adds to a card's name when it settles: the card's big number. */
const spoken = new Map<string, string>();

const num = (n: number, digits = 0) => n.toLocaleString('en-GB', { maximumFractionDigits: digits });
const signed = (n: number, digits = 0) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${num(Math.abs(n), digits)}`;
/** Today on the person's device, as a day. */
const today = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

/** "+120 kcal vs last week", "same as last week", or null when there is no earlier number. Neutral: nothing says up is good or bad. */
function delta(cur: number | null, prev: number | null, unit: string, digits = 0): string | null {
  if (cur === null || prev === null) return null;
  const d = cur - prev;
  if (Math.abs(d) < 0.5 * 10 ** -digits) return `same as ${against()}`; // would show as 0
  return `${signed(d, digits)} ${unit} vs ${against()}`.replace(/ +/g, ' ');
}
const join = (...parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(' · ');

interface Built {
  key: CardKey;
  name: string;
  /** Said with the card's name when it comes into view. */
  say?: string;
  body: Child[];
}

const MISSING = '–';

function weekCard(r: WeekReview): Built {
  const month = r.period === 'month';
  const name = month ? 'The 4 weeks' : 'The week';
  const n = r.nutrition;
  const strip = month ? monthStrip({ days: r.days, goalKcal: n.goals.kcal, label: 'Each day of the last 4 weeks: calories and workout, with the average calories of each week.' }) : weekStrip({ days: r.days, goalKcal: n.goals.kcal, label: 'Each day of the week: calories, workout and weigh-in.' });
  return {
    key: 'week',
    name,
    body: [heading(name), strip, caption(join(WORKOUT_KEY, n.goals.kcal ? `dashed: calorie goal ${num(n.goals.kcal)}` : null)), r.highlights.length > 0 && subhead('Went well'), ...r.highlights.slice(0, 3).map((x) => h('p', { className: 'hline' }, x))],
  };
}

const notesBuilt = (key: 'training-notes' | 'nutrition-notes', name: string, r: WeekReview): Built => ({ key, name, body: notesCard(name, key === 'training-notes' ? r.notes.training : r.notes.nutrition, r.period) });

function foodCard(r: WeekReview): Built {
  const n = r.nutrition;
  const name = 'Food';
  const period = r.period === 'month' ? 'month' : 'week';
  if (!n.average) return { key: 'food', name, body: [heading(name), empty(`No food logged this ${period}. Tell Claude what you eat to fill this card.`)] };
  const a = n.average;
  const e = a.extras;
  const number = `${num(a.kcal)} kcal`;
  const g = (v: number, d = 0) => `${num(v, d)} g`;
  return {
    key: 'food',
    name,
    say: number,
    body: [
      heading(name),
      tint(number, join(`a day${r.inProgress ? ' so far' : ''}`, n.goals.kcal ? `goal ${num(n.goals.kcal)}` : null, delta(a.kcal, n.previousAverage?.kcal ?? null, 'kcal'))),
      hrow('Protein', g(a.protein), n.goals.proteinG ? `goal ${g(n.goals.proteinG)}` : null, join(n.goals.proteinG !== null && n.proteinReached !== null && n.daysLogged > 0 ? `reached on ${n.proteinReached} of ${n.daysLogged} logged days` : null, delta(a.protein, n.previousAverage?.protein ?? null, 'g'))),
      e?.fiber !== undefined && hrow('Fiber', g(e.fiber, 1), n.goals.fiberG ? `target ${g(n.goals.fiberG)}` : null),
      e?.sugar !== undefined && hrow('Sugar', g(e.sugar, 1), null, e.addedSugar !== undefined ? `${g(e.addedSugar, 1)} added${n.goals.addedSugarG ? `, limit ${g(n.goals.addedSugarG)}` : ''}` : null),
      e?.satFat !== undefined && hrow('Sat. fat', g(e.satFat, 1), n.goals.satFatG ? `limit ${g(n.goals.satFatG)}` : null),
      e?.salt !== undefined && hrow('Salt', g(e.salt, 1)),
      hrow('Days logged', `${n.daysLogged} of ${r.daysCounted}`, null, n.kcalWithin10Pct !== null ? `within 10 % of the calorie goal on ${n.kcalWithin10Pct} ${n.kcalWithin10Pct === 1 ? 'day' : 'days'}` : null),
    ],
  };
}

function trainingCard(r: WeekReview): Built {
  const t = r.training;
  const name = 'Training';
  const sessions = t.strength + t.cardio + t.session;
  if (sessions === 0) return { key: 'training', name, body: [heading(name), empty(`No workouts logged this ${r.period === 'month' ? 'month' : 'week'}. Tell Claude about a workout to fill this card.`), t.goalPerWeek ? hrow('Goal', `${t.goalPerWeek} a week`) : null] };
  const parts = [`${t.strength} strength`, `${t.cardio} cardio${t.cardioMin ? ` (${t.cardioMin} min)` : ''}`, t.session ? `${t.session} ${t.session === 1 ? 'class' : 'classes'} (${t.sessionMin} min)` : null];
  return {
    key: 'training',
    name,
    say: `${sessions} ${sessions === 1 ? 'workout' : 'workouts'}`,
    body: [
      heading(name),
      tint(String(sessions), join(sessions === 1 ? 'workout' : 'workouts', t.goalPerWeek ? `goal ${t.goalPerWeek} a week` : null, delta(sessions, t.previousSessions, '')), h('p', { className: 'muted small' }, join(...parts))),
      t.records.length > 0 ? subhead('New estimated bests') : empty('No new estimated bests in this period.'),
      ...t.records.map((x) => hrow(shortName(x.name), x.previousKg === null ? `${num(x.e1rmKg, 1)} kg` : gain(x.e1rmKg, x.previousKg))),
    ],
  };
}

function bodyCard(r: WeekReview): Built {
  const w = r.weight;
  const hb = r.habits;
  const name = 'Body';
  const number = w.averageKg !== null ? `${num(w.averageKg, 1)} kg` : MISSING;
  return {
    key: 'body',
    name,
    say: w.averageKg !== null ? number : undefined,
    body: [
      heading(name),
      tint(number, w.averageKg !== null ? join('7-day average', delta(w.averageKg, w.previousAverageKg, 'kg', 1), w.goalKg !== null ? `goal ${num(w.goalKg, 1)}` : null) : 'The average needs 3 weigh-ins in a week.'),
      hrow('Weigh-ins', String(w.weighIns), null, w.weighIns < 3 ? 'the average needs 3 or more' : null),
      hb.sleepHours !== null && hrow('Sleep', `${num(hb.sleepHours, 1)} h`, 'a night', delta(hb.sleepHours, hb.previousSleepHours, 'h', 1)),
      hb.steps !== null && hrow('Steps', num(hb.steps), 'a day', delta(hb.steps, hb.previousSteps, 'steps')),
      hb.waterMl !== null && hrow('Water', `${num(hb.waterMl / 1000, 1)} L`, 'a day', delta(hb.waterMl / 1000, hb.previousWaterMl === null ? null : hb.previousWaterMl / 1000, 'L', 1)),
    ],
  };
}

function energyCard(r: WeekReview): Built {
  const en = r.energy;
  const name = 'Energy';
  if (en.expenditureKcal === null) return { key: 'energy', name, body: [heading(name), tint(MISSING, 'No estimate yet.'), empty(en.reason ?? 'It needs about 4 weeks of logged food and weigh-ins.')] };
  const number = `${num(en.expenditureKcal)} kcal`;
  const word = en.confidence ? CONFIDENCE_WORD[en.confidence] : 'rough';
  return {
    key: 'energy',
    name,
    say: `${number} burned a day`,
    body: [
      heading(name),
      tint(number, `burned a day, ${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word} estimate · ${en.daysCounted} days, ${en.weighIns} weigh-ins`),
      en.trendKgPerWeek !== null && hrow('Weight trend', `${signed(en.trendKgPerWeek, 2)} kg`, 'a week'),
      en.suggestedKcal !== null && hrow(en.direction === 'maintain' ? 'To keep the weight' : `To ${en.direction} ${num(en.suggestedRateKgPerWeek ?? 0, 2)} kg a week`, `${num(en.suggestedKcal)} kcal`, null, en.goalKcal ? `your goal is ${num(en.goalKcal)}` : null),
      en.goalDate && hrow('Goal weight around', fmtDay(en.goalDate), null, 'at the current trend'),
      empty(`From what you logged and how your weight moved over ${fmtDay(en.from)} to ${fmtDay(en.to)}.${en.notes.length ? ` ${en.notes.join(' ')}` : ''}`),
    ],
  };
}

function considerCard(r: WeekReview): Built {
  const name = 'To consider';
  return {
    key: 'consider',
    name,
    body: [
      heading(name),
      ...r.suggestions.map((x) => h('p', { className: 'hline' }, x)),
      r.plan && hrow('Meal plan', `${r.plan.logged} of ${r.plan.meals}`, 'planned meals logged'),
      r.suggestions.length > 0 ? empty('Ask Claude about any of these.') : !r.plan && empty('Nothing to suggest right now.'),
    ],
  };
}

const cardsOf = (r: WeekReview): Built[] => [weekCard(r), notesBuilt('training-notes', 'Training notes', r), notesBuilt('nutrition-notes', 'Nutrition notes', r), foodCard(r), trainingCard(r), bodyCard(r), energyCard(r), considerCard(r)];

// ---------- the pager ----------
const titleOf = (r: WeekReview) => (r.period === 'month' ? monthTitle(lastWeekOf(r), today()) : weekTitle(r.weekStart, today()));
const stepOf = (r: WeekReview) => (r.period === 'month' ? 28 : 7);

/** Under the card's name: which period, how far into it, and what the numbers are compared with. */
function subOf(r: WeekReview, key: string) {
  const title = titleOf(r);
  const range = `${fmtDay(r.weekStart)} – ${fmtDay(r.weekEnd)}`;
  return join(title ?? range, r.inProgress && `${r.daysCounted} of ${r.period === 'month' ? 28 : 7} days`, COMPARES.includes(key as CardKey) && `vs ${against()}`, state.loading && 'updating…');
}

function periodButtons(r: WeekReview) {
  return h('div', { className: 'periods', role: 'group', 'aria-label': 'Period' }, ...(['week', 'month'] as const).map((k) => h('button', { type: 'button', className: 'link', 'data-key': `period-${k}`, 'aria-pressed': String(r.period === k), disabled: state.loading, onclick: () => { if (r.period !== k) void go(0, lastWeekOf(r), k); } }, k === 'week' ? 'Week' : 'Month')));
}

/** Previous, this week and next, at the bottom of every card. An ended button is aria-disabled: it keeps its place and does nothing. */
function dock(r: WeekReview) {
  const month = r.period === 'month';
  const word = month ? 'month' : 'week';
  const isThis = titleOf(r) === `This ${word}`;
  const nextRunning = month ? addDays(lastWeekOf(r), 28) > mondayOf(today()) : r.inProgress;
  const button = (key: string, text: string, label: string, off: boolean, run: () => void) => h('button', { type: 'button', 'data-key': key, 'aria-label': label, 'aria-disabled': off ? 'true' : undefined, disabled: state.loading, onclick: () => { if (!off) run(); } }, text);
  return h('div', { className: 'dock pager3' }, button('dock-prev', '‹ Prev', `Previous ${word}`, false, () => void go(-stepOf(r))), button('dock-this', `This ${word}`, `This ${word}`, isThis, () => void go(0, mondayOf(today()))), button('dock-next', 'Next ›', `Next ${word}`, nextRunning, () => void go(stepOf(r))));
}

/** A drawing bug must never leave a blank frame: say so, and tell the host's log. */
function render() {
  try {
    draw();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    pager?.destroy();
    pager = null;
    root.replaceChildren(h('p', { className: 'error center' }, 'The review could not be drawn.'), h('p', { className: 'muted small center' }, message));
    void app.sendLog({ level: 'error', data: `review draw failed: ${message}` }).catch(() => undefined);
  }
}

function draw() {
  const r = state.review;
  if (!r) {
    root.replaceChildren(h('p', { className: state.error ? 'error center' : 'muted center' }, state.error || 'Loading your week…'));
    return;
  }
  const focusKey = document.activeElement?.getAttribute('data-key');
  const built = cardsOf(r);
  const infos = built.map((c) => ({ key: c.key, name: c.name }));
  spoken.clear();
  for (const c of built) if (c.say) spoken.set(c.key, c.say);
  const first = !pager;
  if (!pager) {
    pager = createCardPager({
      title: 'Weekly review',
      cards: infos,
      labelRow: true,
      trackLabel: 'Review cards',
      onSettle: (pos) => {
        state.cardKey = (pager!.cards()[pos]?.dataset.key as CardKey | undefined) ?? state.cardKey;
        pager!.refreshHeader();
        pager!.refreshCards();
      },
      announceText: (pos) => {
        const c = pager!.cards()[pos];
        const say = c?.dataset.key ? spoken.get(c.dataset.key) : undefined;
        return `${c?.getAttribute('data-name') ?? ''}, card ${pos + 1} of ${pager!.cards().length}${say ? `, ${say}` : ''}`;
      },
      focusTarget: (card) => card.querySelector<HTMLElement>('[data-focus]'),
    });
  }
  pager.setTitle(r.period === 'month' ? 'Monthly review' : 'Weekly review');
  const at = Math.max(0, infos.findIndex((c) => c.key === state.cardKey));
  const cards = pager.setCards(infos, at);
  pager.setLabel({ sub: (pos) => subOf(r, infos[pos]?.key ?? ''), right: periodButtons(r) });
  built.forEach((c, i) => {
    const card = cards[i]!;
    const top = card.scrollTop;
    card.dataset.key = c.key;
    card.setAttribute('data-name', c.name);
    card.replaceChildren(...[...c.body, dock(r)].filter((x): x is Node | string => x !== null && x !== false && x !== undefined));
    card.scrollTop = top;
    card.style.setProperty('--dock-h', `${card.querySelector<HTMLElement>('.dock')?.offsetHeight ?? 0}px`);
  });
  pager.refreshCards();
  if (first) root.replaceChildren(pager.header, ...(state.error ? [h('p', { className: 'error small' }, state.error)] : []), pager.track);
  else {
    root.querySelector('p.error')?.remove();
    if (state.error) pager.header.after(h('p', { className: 'error small' }, state.error));
  }
  if (pager.pos() !== at) pager.goTo(at, { auto: true });
  if (focusKey) (pager.cards()[pager.pos()]?.querySelector<HTMLElement>(`[data-key="${focusKey}"]`) ?? pager.header.querySelector<HTMLElement>(`[data-key="${focusKey}"]`))?.focus({ preventScroll: true });
}

async function go(deltaDays: number, weekStart?: string, period?: 'week' | 'month') {
  const r = state.review;
  if (!r || state.loading) return;
  const shown = period ?? r.period;
  state.loading = true;
  state.error = '';
  render();
  try {
    const res = await app.callServerTool({ name: 'get_review_data', arguments: { week_start: weekStart ?? addDays(lastWeekOf(r), deltaDays), period: shown } });
    const review = (res.structuredContent as { review?: WeekReview } | undefined)?.review;
    if (res.isError || !review) throw new Error('no data');
    state.review = review;
  } catch {
    state.error = `Could not load that ${shown}. Try again.`;
  }
  state.loading = false;
  render();
}

function applyHost(ctx: McpUiHostContext | undefined) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

app.ontoolresult = (result) => {
  const review = (result.structuredContent as { review?: WeekReview } | undefined)?.review;
  if (review) {
    state.review = review;
    render();
  } else if (result.isError) {
    state.error = 'The review could not be opened. Claude will explain why.';
    render();
  }
};
app.onhostcontextchanged = (ctx) => {
  applyHost(ctx);
  render();
};

await app.connect();
applyHost(app.getHostContext());
render();
