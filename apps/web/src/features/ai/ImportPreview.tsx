import { useEffect, useMemo, useState } from 'preact/hooks';
import { Badge, Button, Field, Notice, Select, Sheet, TextInput } from '../../ui';
import { buildExercises, defaultChoice, suggest, type AiWorkout, type Choice, type Suggestion } from '../../ai/importWorkout';
import { fromCustom, loadExercises, prepareExercises, type Exercise } from '@fitwell/core/data/exercises';
import { customExercisesRepo } from '../../db/workoutStore';
import { isDay } from '@fitwell/core/domain/dates';
import { weightUnit, type UnitSystem } from '@fitwell/core/domain/units';
import { formatDuration } from '@fitwell/core/domain/workouts';
import { currentWeightKg, settings } from '../../state';
import { t } from '../../i18n';
import { createStrength, newId } from '../workout/actions';

const OWN = '__own';
const SKIP = '__skip';

/** The AI's own summary of an exercise, so you can compare it with what the app understood. */
function setsText(ex: AiWorkout['exercises'][number], unit: string): string {
  const parts = ex.sets.map((s) => {
    const measure = (s.seconds ?? 0) > 0 && !(s.reps ?? 0) ? formatDuration(s.seconds!) : `${s.reps ?? 0}`;
    const load = ex.load === 'bodyweight' ? ((s.added ?? s.weight ?? 0) > 0 ? ` + ${s.added ?? s.weight} ${unit}` : ' BW') : (s.weight ?? 0) > 0 ? ` @ ${s.weight} ${unit}` : '';
    return `${s.type === 'warmup' ? 'W ' : ''}${measure}${load}`;
  });
  return parts.join(', ');
}

/** Check what the AI sent before anything is saved: match each exercise, set the day, then add. */
export function ImportPreview({ workout, defaultDay, onClose }: { workout: AiWorkout; defaultDay: string; onClose: () => void }) {
  const units: UnitSystem = settings.value.units;
  const fileUnit = workout.units ?? weightUnit(units);
  const [library, setLibrary] = useState<Exercise[] | null>(null);
  const [day, setDay] = useState(workout.day ?? defaultDay);
  const [name, setName] = useState(workout.name ?? '');
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.all([loadExercises(), customExercisesRepo.list()]).then(([lib, mine]) => {
      if (live) setLibrary([...mine.map(fromCustom), ...lib.exercises]);
    });
    return () => {
      live = false;
    };
  }, []);

  const suggestions = useMemo<Suggestion[] | null>(() => {
    if (!library) return null;
    const index = prepareExercises(library);
    return workout.exercises.map((e) => suggest(e.name, index, library));
  }, [library, workout]);

  useEffect(() => {
    if (suggestions && !choices) setChoices(suggestions.map(defaultChoice));
  }, [suggestions]);

  const ready = suggestions && choices;
  const kept = choices?.filter((c) => c.kind !== 'skip').length ?? 0;
  const dayError = isDay(day) ? '' : t('ai.err.day');

  async function add() {
    if (!choices || !isDay(day) || kept === 0) return;
    setBusy(true);
    const refs = new Map<string, string>();
    for (const [i, c] of choices.entries()) {
      if (c.kind !== 'own') continue;
      const ex = workout.exercises[i]!;
      if (!refs.has(ex.name)) refs.set(ex.name, `cx:${(await customExercisesRepo.create({ name: ex.name, primary: [], equipment: 'other' })).id}`);
    }
    const exercises = buildExercises({ workout, choices, defaultUnits: units, bodyKg: currentWeightKg() ?? 0, newId, ownRef: (n) => refs.get(n) ?? `cx:${n}` });
    const w = await createStrength(day, exercises, name.trim() || undefined);
    onClose();
    location.hash = `#/workout/${w.id}`;
  }

  return (
    <Sheet title={t('ai.preview.title')} onClose={onClose} tall>
      <div class="stack gap-4">
        <p class="t-caption">{t('ai.preview.help')}</p>
        <div class="field-row">
          <Field label={t('ai.day')} error={dayError} class="grow">
            {(c) => <TextInput {...c} type="date" value={day} onInput={(e) => setDay((e.target as HTMLInputElement).value)} />}
          </Field>
          <Field label={t('ai.name')} class="grow">
            {(c) => <TextInput {...c} autocomplete="off" maxLength={80} placeholder={t('ai.name.placeholder')} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />}
          </Field>
        </div>
        {!ready && <p class="muted" role="status">{t('common.loading')}</p>}
        {ready &&
          workout.exercises.map((ex, i) => {
            const s = suggestions[i]!;
            const c = choices[i]!;
            const pool = [...(s.exact ? [s.exact] : []), ...s.options];
            const value = c.kind === 'ref' ? c.ref : c.kind === 'own' ? OWN : SKIP;
            const status = c.kind === 'skip' ? null : c.kind === 'ref' && s.exact?.ref === c.ref ? 'matched' : c.kind === 'own' ? 'new' : 'check';
            return (
              <section key={i} class="stack gap-2" aria-label={ex.name}>
                <div class="slot-head">
                  <h3 class="grow">{ex.name}</h3>
                  {status && <Badge>{t(`ai.match.${status}` as 'ai.match.matched')}</Badge>}
                </div>
                <p class="t-caption">{setsText(ex, fileUnit)}</p>
                <Field label={t('ai.use')} labelHidden>
                  {(f) => (
                    <Select
                      {...f}
                      value={value}
                      onChange={(e) => {
                        const v = (e.target as HTMLSelectElement).value;
                        const next: Choice = v === OWN ? { kind: 'own' } : v === SKIP ? { kind: 'skip' } : { kind: 'ref', ref: v, name: pool.find((p) => p.ref === v)?.name ?? ex.name };
                        setChoices(choices.map((x, j) => (j === i ? next : x)));
                      }}
                    >
                      {pool.map((p) => <option key={p.ref} value={p.ref}>{p.name}</option>)}
                      <option value={OWN}>{t('ai.opt.own')}</option>
                      <option value={SKIP}>{t('ai.opt.skip')}</option>
                    </Select>
                  )}
                </Field>
              </section>
            );
          })}
        {ready && kept === 0 && <Notice>{t('ai.preview.none')}</Notice>}
        <Button variant="primary" block disabled={!ready || busy || kept === 0 || !!dayError} onClick={() => void add()}>
          {t('ai.add')}
        </Button>
      </div>
    </Sheet>
  );
}
