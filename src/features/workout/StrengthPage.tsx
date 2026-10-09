import { useEffect, useRef, useState } from 'preact/hooks';
import { Badge, Button, Card, EmptyState, Field, Icon, LinkButton, Screen, Sheet, TextInput } from '../../ui';
import { lastPerformance, workoutsRepo } from '../../db/workoutStore';
import type { Workout, WorkoutExercise, WorkoutSet } from '../../db/schema';
import { formatDay, today } from '../../domain/dates';
import { displayWeight, toKg, weightUnit } from '../../domain/units';
import { newSet, summarizeSets } from '../../domain/workouts';
import { routeId } from '../../router';
import { settings } from '../../state';
import { t } from '../../i18n';
import { deleteWorkout, newId, saveAsTemplate } from './actions';
import { ExercisePicker, HowTo } from './ExercisePicker';
import { NumberCell } from './NumberCell';
import { showToast } from '../food/toast';

interface Last { summary: string; day: string; first?: Pick<WorkoutSet, 'reps' | 'weightKg'> }

/** Strength workout: exercises → sets (weight, reps, warm-up or working). Every change is saved as you go. */
export function StrengthPage() {
  const id = routeId.value!;
  const units = settings.value.units;
  const [w, setW] = useState<Workout | null | 'missing'>(null);
  const [picking, setPicking] = useState(false);
  const [templating, setTemplating] = useState(false);
  const [last, setLast] = useState<Record<string, Last | null>>({});
  const latest = useRef<WorkoutExercise[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = () => {
    clearTimeout(timer.current);
    const ex = latest.current;
    latest.current = null;
    if (ex) void workoutsRepo.update(id, { exercises: ex });
  };

  useEffect(() => {
    let live = true;
    void workoutsRepo.get(id).then((r) => live && setW(r ?? 'missing'));
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
      // Leaving an empty workout behind would clutter the day: drop it quietly.
      void workoutsRepo.get(id).then((r) => {
        if (r && r.type === 'strength' && !r.exercises?.length) void workoutsRepo.remove(id);
      });
    };
  }, [id]);

  // "Last time" for each exercise in this workout.
  useEffect(() => {
    if (!w || w === 'missing') return;
    for (const e of w.exercises ?? []) {
      if (e.exerciseRef in last) continue;
      setLast((l) => ({ ...l, [e.exerciseRef]: null }));
      void lastPerformance(e.exerciseRef, w).then((r) => {
        const working = r?.exercise.sets.filter((s) => s.type === 'working' && s.reps > 0) ?? [];
        setLast((l) => ({ ...l, [e.exerciseRef]: r ? { summary: summarizeSets(r.exercise.sets, units), day: r.workout.day, first: working[0] } : null }));
      });
    }
  }, [w && w !== 'missing' ? w.exercises?.map((e) => e.exerciseRef).join(',') : '', w && w !== 'missing' ? w.id : '']);

  if (w === null) return <Screen title={t('workout.strength')}><p class="muted" role="status">{t('common.loading')}</p></Screen>;
  if (w === 'missing') {
    return (
      <Screen title={t('workout.strength')}>
        <EmptyState>{t('workout.missing')}</EmptyState>
        <Button onClick={() => (location.hash = '#/today')}>{t('review.back')}</Button>
      </Screen>
    );
  }

  const exercises = w.exercises ?? [];
  const commit = (next: WorkoutExercise[]) => {
    setW({ ...w, exercises: next });
    latest.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 300);
  };
  const edit = (ei: number, fn: (e: WorkoutExercise) => WorkoutExercise) => commit(exercises.map((e, i) => (i === ei ? fn(e) : e)));
  const unit = weightUnit(units);

  async function addExercise(ex: { ref: string; name: string }) {
    setPicking(false);
    const prev = await lastPerformance(ex.ref, w as Workout);
    const first = prev?.exercise.sets.find((s) => s.type === 'working' && s.reps > 0);
    commit([...exercises, { exerciseRef: ex.ref, exerciseName: ex.name, sets: [newSet(newId(), 'working', first)] }]);
  }

  return (
    <Screen title={w.name?.trim() || t('workout.strength')} subtitle={formatDay(w.day)}>
      <LinkButton onClick={() => (location.hash = w.day === today() ? '#/today' : `#/today/${w.day}`)}>
        <Icon name="prev" size="sm" />{t('review.back')}
      </LinkButton>

      {exercises.length === 0 && <EmptyState>{t('workout.emptyStrength')}</EmptyState>}

      {exercises.map((ex, ei) => {
        const l = last[ex.exerciseRef];
        let workingNo = 0;
        return (
          <Card key={ex.exerciseRef} labelledBy={`ex-${ei}`}>
            <div class="stack gap-3">
              <div class="slot-head">
                <h2 id={`ex-${ei}`}>{ex.exerciseName}</h2>
                <Button icon aria-label={`${t('workout.removeExercise')} ${ex.exerciseName}`} onClick={() => commit(exercises.filter((_, i) => i !== ei))}>
                  <Icon name="trash" size="sm" />
                </Button>
              </div>
              {l?.summary && (
                <p class="t-caption">
                  <Badge>{t('workout.lastTime')}</Badge> {l.summary} · {formatDay(l.day, { month: 'short', day: 'numeric' })}
                </p>
              )}
              <div class="set-grid" role="group" aria-label={`${ex.exerciseName}: ${t('workout.sets')}`}>
                <span class="t-overline">{t('workout.set')}</span>
                <span class="t-overline">{unit}</span>
                <span class="t-overline">{t('workout.reps')}</span>
                <span />
                {ex.sets.map((s, si) => {
                  if (s.type === 'working') workingNo++;
                  const label = s.type === 'warmup' ? t('workout.warmupShort') : String(workingNo);
                  const setName = `${t('workout.set')} ${si + 1}`;
                  return (
                    <div class="set-row" key={s.id}>
                      <Button
                        size="sm"
                        class="set-type"
                        aria-pressed={s.type === 'warmup'}
                        aria-label={`${setName}: ${s.type === 'warmup' ? t('workout.warmup') : t('workout.working')}. ${t('workout.toggleType')}`}
                        onClick={() => edit(ei, (e) => ({ ...e, sets: e.sets.map((x) => (x.id === s.id ? { ...x, type: x.type === 'warmup' ? 'working' : 'warmup' } : x)) }))}
                      >
                        {label}
                      </Button>
                      <NumberCell
                        label={`${setName} ${unit}`}
                        value={displayWeight(s.weightKg, units)}
                        placeholder="0"
                        onValue={(n) => edit(ei, (e) => ({ ...e, sets: e.sets.map((x) => (x.id === s.id ? { ...x, weightKg: toKg(n, units) } : x)) }))}
                      />
                      <NumberCell
                        integer
                        label={`${setName} ${t('workout.reps')}`}
                        value={s.reps}
                        placeholder="0"
                        onValue={(n) => edit(ei, (e) => ({ ...e, sets: e.sets.map((x) => (x.id === s.id ? { ...x, reps: n } : x)) }))}
                      />
                      <Button icon aria-label={`${t('workout.removeSet')} ${si + 1}`} onClick={() => edit(ei, (e) => ({ ...e, sets: e.sets.filter((x) => x.id !== s.id) }))}>
                        <Icon name="close" size="sm" />
                      </Button>
                    </div>
                  );
                })}
              </div>
              <Button
                block
                onClick={() =>
                  edit(ei, (e) => {
                    const prev = [...e.sets].reverse().find((x) => x.type === 'working') ?? e.sets[e.sets.length - 1];
                    return { ...e, sets: [...e.sets, newSet(newId(), 'working', prev ?? l?.first)] };
                  })
                }
              >
                <Icon name="plus" size="sm" />{t('workout.addSet')}
              </Button>
              {ex.exerciseRef.startsWith('ex:') && <HowTo ex={{ ref: ex.exerciseRef, name: ex.exerciseName, equipment: '', primary: [], secondary: [] }} />}
            </div>
          </Card>
        );
      })}

      {exercises.length > 0 && (
        <div class="cluster between">
          <LinkButton onClick={() => setTemplating(true)}>{t('workout.saveTemplate')}</LinkButton>
          <LinkButton
            onClick={async () => {
              flush();
              await deleteWorkout(w);
              location.hash = '#/today';
            }}
          >
            {t('workout.delete')}
          </LinkButton>
        </div>
      )}

      <div class="primary-bar">
        <Button variant="primary" size="lg" block onClick={() => setPicking(true)}>
          <Icon name="plus" />{t('exercise.add')}
        </Button>
      </div>

      {picking && <ExercisePicker onClose={() => setPicking(false)} onPick={(e) => void addExercise({ ref: e.ref, name: e.name })} />}
      {templating && (
        <TemplateSheet
          onClose={() => setTemplating(false)}
          onSave={async (name) => {
            flush();
            await saveAsTemplate({ ...w, exercises }, name);
            setTemplating(false);
            showToast(t('workout.templateSaved'));
          }}
        />
      )}
    </Screen>
  );
}

export function TemplateSheet({ onSave, onClose, initial = '' }: { onSave: (name: string) => void; onClose: () => void; initial?: string }) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState('');
  return (
    <Sheet title={t('workout.saveTemplate')} onClose={onClose}>
      <form
        class="stack gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return setError(t('workout.templateNameError'));
          onSave(name);
        }}
      >
        <Field label={t('workout.templateName')} error={error}>
          {(c) => <TextInput {...c} autofocus autocomplete="off" value={name} onInput={(e) => (setName((e.target as HTMLInputElement).value), setError(''))} />}
        </Field>
        <Button type="submit" variant="primary" block>{t('workout.templateSave')}</Button>
      </form>
    </Sheet>
  );
}
