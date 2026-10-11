import { useEffect, useRef, useState } from 'preact/hooks';
import { Badge, Button, Card, Choice, EmptyState, Field, Icon, LinkButton, Screen, Segmented, Sheet, TextInput } from '../../ui';
import { lastPerformance, workoutsRepo } from '../../db/workoutStore';
import type { Workout, WorkoutExercise, WorkoutSet } from '../../db/schema';
import { formatDay, today } from '../../domain/dates';
import { displayWeight, toKg, weightUnit } from '../../domain/units';
import { addedLoadKg, formatDuration, newSet, normalizeSupersets, parseDuration, summarizeSets, supersetPosition } from '../../domain/workouts';
import { routeId } from '../../router';
import { currentWeightKg, settings } from '../../state';
import { t } from '../../i18n';
import { deleteWorkout, newId, saveAsTemplate } from './actions';
import { ExercisePicker, HowTo } from './ExercisePicker';
import { NumberCell } from './NumberCell';
import { showToast } from '../food/toast';

interface Last { summary: string; day: string; first?: Pick<WorkoutSet, 'reps' | 'weightKg' | 'durationSec' | 'bodyweightKg'>; mode?: 'reps' | 'time'; load?: 'weight' | 'bodyweight' }

/** Strength workout: exercises → sets (weight, reps or time, warm-up or working). Every change is saved as you go. */
export function StrengthPage() {
  const id = routeId.value!;
  const units = settings.value.units;
  const [w, setW] = useState<Workout | null | 'missing'>(null);
  const [picking, setPicking] = useState(false);
  const [templating, setTemplating] = useState(false);
  const [last, setLast] = useState<Record<string, Last | null>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState<{ setId: string; uid: string; startedAt: number } | null>(null);
  const [now, setNow] = useState(Date.now());
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
    void workoutsRepo.get(id).then((r) => {
      if (!live) return;
      // Older workouts have no exercise ids; give them one in memory (it is saved with the next change).
      setW(r ? { ...r, exercises: r.exercises?.map((e) => (e.uid ? e : { ...e, uid: newId() })) } : 'missing');
    });
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

  // Tick the stopwatch while a timed set is running.
  useEffect(() => {
    if (!running) return;
    const i = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(i);
  }, [running?.setId]);

  // "Last time" for each exercise in this workout.
  useEffect(() => {
    if (!w || w === 'missing') return;
    for (const e of w.exercises ?? []) {
      if (e.exerciseRef in last) continue;
      setLast((l) => ({ ...l, [e.exerciseRef]: null }));
      void lastPerformance(e.exerciseRef, w).then((r) => {
        const working = r?.exercise.sets.filter((s) => s.type === 'working' && (s.reps > 0 || (s.durationSec ?? 0) > 0)) ?? [];
        setLast((l) => ({
          ...l,
          [e.exerciseRef]: r ? { summary: summarizeSets(r.exercise.sets, units, r.exercise), day: r.workout.day, first: working[0], mode: r.exercise.mode, load: r.exercise.load } : null,
        }));
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
  const bodyKg = () => currentWeightKg() ?? 0;

  const setCollapsedFor = (uid: string, on: boolean) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (on) n.add(uid);
      else n.delete(uid);
      return n;
    });

  function stopTimer() {
    if (!running) return;
    const secs = Math.max(1, Math.round((Date.now() - running.startedAt) / 1000));
    const ei = exercises.findIndex((e) => e.uid === running.uid);
    setRunning(null);
    if (ei >= 0) edit(ei, (e) => ({ ...e, sets: e.sets.map((x) => (x.id === running.setId ? { ...x, durationSec: secs } : x)) }));
  }

  async function addExercise(ex: { ref: string; name: string }) {
    setPicking(false);
    const prev = await lastPerformance(ex.ref, w as Workout);
    const first = prev?.exercise.sets.find((s) => s.type === 'working' && (s.reps > 0 || (s.durationSec ?? 0) > 0));
    const load = prev?.exercise.load;
    let seed = first;
    if (first && load === 'bodyweight') seed = { ...first, bodyweightKg: bodyKg(), weightKg: bodyKg() + addedLoadKg(first) };
    const uid = newId();
    const added: WorkoutExercise = {
      uid,
      exerciseRef: ex.ref,
      exerciseName: ex.name,
      ...(prev?.exercise.mode ? { mode: prev.exercise.mode } : {}),
      ...(load ? { load } : {}),
      sets: [newSet(newId(), 'working', seed)],
    };
    // Focus on the new exercise: fold the others away.
    setCollapsed(new Set(exercises.map((e) => e.uid!)));
    commit([...exercises, added]);
  }

  function setLoad(ei: number, load: 'weight' | 'bodyweight') {
    edit(ei, (e) => {
      if ((e.load ?? 'weight') === load) return e;
      const bw = bodyKg();
      return {
        ...e,
        load,
        sets: e.sets.map((x) => {
          const rest = { ...x };
          delete rest.bodyweightKg;
          return load === 'bodyweight' ? { ...rest, weightKg: bw, bodyweightKg: bw } : { ...rest, weightKg: 0 };
        }),
      };
    });
  }

  function setLinked(ei: number, on: boolean) {
    if (ei === 0) return;
    const next = exercises.map((e) => ({ ...e }));
    if (on) {
      const sid = next[ei - 1]!.supersetId ?? newId();
      next[ei - 1]!.supersetId = sid;
      next[ei]!.supersetId = sid;
    } else {
      delete next[ei]!.supersetId;
    }
    commit(normalizeSupersets(next, newId));
  }

  const removeExercise = (ei: number) => commit(normalizeSupersets(exercises.filter((_, i) => i !== ei), newId));

  const addSetTo = (e: WorkoutExercise, l: Last | null | undefined): WorkoutExercise => {
    const prev = [...e.sets].reverse().find((x) => x.type === 'working') ?? e.sets[e.sets.length - 1];
    return { ...e, sets: [...e.sets, newSet(newId(), 'working', prev ?? l?.first)] };
  };

  return (
    <Screen
      title={w.name?.trim() || t('workout.strength')}
      subtitle={formatDay(w.day)}
      onSubtitle={() => (location.hash = w.day === today() ? '#/today' : `#/today/${w.day}`)}
      subtitleAction={t('workout.openDay')}
    >

      {exercises.length === 0 && <EmptyState>{t('workout.emptyStrength')}</EmptyState>}

      {exercises.map((ex, ei) => {
        const uid = ex.uid!;
        const l = last[ex.exerciseRef];
        const isTime = ex.mode === 'time';
        const isBw = ex.load === 'bodyweight';
        const pos = supersetPosition(exercises, ei);
        const isCollapsed = collapsed.has(uid);
        const today_ = summarizeSets(ex.sets, units, ex);
        let workingNo = 0;
        return (
          <Card key={uid} labelledBy={`ex-${uid}`} class={pos ? `superset${pos.first ? ' first' : ''}${pos.last ? ' last' : ''}` : undefined}>
            <div class="stack gap-3">
              <div class="slot-head">
                <button
                  type="button"
                  class="ex-toggle"
                  aria-expanded={!isCollapsed}
                  aria-controls={`ex-body-${uid}`}
                  onClick={() => setCollapsedFor(uid, !isCollapsed)}
                >
                  <span class="ex-title">
                    <h2 id={`ex-${uid}`}>{ex.exerciseName}</h2>
                    {isCollapsed && <span class="t-caption muted">{today_ || t('workout.noSetsYet')}</span>}
                  </span>
                  <span class={isCollapsed ? 'chev' : 'chev open'}><Icon name="expand" size="sm" /></span>
                </button>
                {!isCollapsed && (
                  <Button icon aria-label={`${t('workout.removeExercise')} ${ex.exerciseName}`} onClick={() => removeExercise(ei)}>
                    <Icon name="trash" size="sm" />
                  </Button>
                )}
              </div>
              {pos && <p class="t-caption"><Badge>{t('workout.superset')} {pos.letter.charCodeAt(0) - 64} {t('workout.of')} {pos.size}</Badge></p>}
              <div id={`ex-body-${uid}`} class="stack gap-3" hidden={isCollapsed}>
                {l?.summary && (
                  <p class="t-caption">
                    <Badge>{t('workout.lastTime')}</Badge> {l.summary} · {formatDay(l.day, { month: 'short', day: 'numeric' })}
                  </p>
                )}
                <div class={isTime ? 'set-grid timed' : 'set-grid'} role="group" aria-label={`${ex.exerciseName}: ${t('workout.sets')}`}>
                  <span class="t-overline">{t('workout.set')}</span>
                  <span class="t-overline">{isBw ? `+ ${unit}` : unit}</span>
                  <span class="t-overline">{isTime ? t('workout.time') : t('workout.reps')}</span>
                  <span />
                  {ex.sets.map((s, si) => {
                    if (s.type === 'working') workingNo++;
                    const label = s.type === 'warmup' ? t('workout.warmupShort') : String(workingNo);
                    const setName = `${t('workout.set')} ${si + 1}`;
                    const live = running?.setId === s.id;
                    const patch = (p: Partial<WorkoutSet>) => edit(ei, (e) => ({ ...e, sets: e.sets.map((x) => (x.id === s.id ? { ...x, ...p } : x)) }));
                    return (
                      <div class="set-row" key={s.id}>
                        <Button
                          size="sm"
                          class="set-type"
                          aria-pressed={s.type === 'warmup'}
                          aria-label={`${setName}: ${s.type === 'warmup' ? t('workout.warmup') : t('workout.working')}. ${t('workout.toggleType')}`}
                          onClick={() => patch({ type: s.type === 'warmup' ? 'working' : 'warmup' })}
                        >
                          {label}
                        </Button>
                        <NumberCell
                          label={`${setName} ${isBw ? t('workout.addedLoad') : ''} ${unit}`.replace('  ', ' ')}
                          value={displayWeight(isBw ? addedLoadKg(s) : s.weightKg, units, 2)}
                          placeholder={isBw ? 'BW' : '0'}
                          onValue={(n) => patch(isBw ? { bodyweightKg: s.bodyweightKg ?? bodyKg(), weightKg: (s.bodyweightKg ?? bodyKg()) + toKg(n, units) } : { weightKg: toKg(n, units) })}
                        />
                        {isTime ? (
                          <DurationCell label={`${setName} ${t('workout.time')}`} seconds={live ? Math.round((now - running!.startedAt) / 1000) : (s.durationSec ?? 0)} onValue={(n) => patch({ durationSec: n })} />
                        ) : (
                          <NumberCell label={`${setName} ${t('workout.reps')}`} value={s.reps} placeholder="0" onValue={(n) => patch({ reps: n })} />
                        )}
                        <Button icon aria-label={`${t('workout.removeSet')} ${si + 1}`} onClick={() => edit(ei, (e) => ({ ...e, sets: e.sets.filter((x) => x.id !== s.id) }))}>
                          <Icon name="close" size="sm" />
                        </Button>
                        {isTime && (
                          <div class="set-timer">
                            <Button
                              size="sm"
                              block
                              aria-label={`${setName}: ${live ? t('workout.stopTimer') : t('workout.startTimer')}`}
                              onClick={() => {
                                if (live) return stopTimer();
                                if (running) stopTimer();
                                setNow(Date.now());
                                setRunning({ setId: s.id, uid, startedAt: Date.now() });
                              }}
                            >
                              <Icon name={live ? 'stop' : 'play'} size="sm" />
                              {live ? `${t('workout.stopTimer')} · ${formatDuration(Math.max(0, Math.round((now - running!.startedAt) / 1000)))}` : t('workout.startTimer')}
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <Button
                  block
                  onClick={() => {
                    const group = pos ? exercises.map((e, i) => (supersetPosition(exercises, i) && e.supersetId === ex.supersetId ? i : -1)).filter((i) => i >= 0) : [ei];
                    commit(exercises.map((e, i) => (group.includes(i) ? addSetTo(e, last[e.exerciseRef]) : e)));
                  }}
                >
                  <Icon name="plus" size="sm" />{pos ? t('workout.addRound') : t('workout.addSet')}
                </Button>
                <div class="ex-more">
                  <details class="howto">
                    <summary>{t('workout.options')}</summary>
                    <div class="stack gap-3 pad-top">
                      <Segmented
                        legend={t('workout.measureBy')}
                        name={`mode-${uid}`}
                        options={[{ value: 'reps', label: t('workout.repsOption') }, { value: 'time', label: t('workout.timeOption') }]}
                        value={ex.mode ?? 'reps'}
                        onChange={(m) => edit(ei, (e) => ({ ...e, mode: m }))}
                      />
                      <Segmented
                        legend={t('workout.loadType')}
                        name={`load-${uid}`}
                        options={[{ value: 'weight', label: t('workout.weight') }, { value: 'bodyweight', label: t('workout.bodyweight') }]}
                        value={ex.load ?? 'weight'}
                        onChange={(m) => setLoad(ei, m)}
                      />
                      {ei > 0 && (
                        <Choice type="checkbox" checked={!!pos && !pos.first} onChange={(on) => setLinked(ei, on)} label={t('workout.supersetWithAbove')} help={t('workout.supersetHelp')} />
                      )}
                    </div>
                  </details>
                  {ex.exerciseRef.startsWith('ex:') && <HowTo ex={{ ref: ex.exerciseRef, name: ex.exerciseName, equipment: '', primary: [], secondary: [] }} />}
                </div>
              </div>
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

/** Duration input: accepts "45", "1:30", "90s"; shows it the same way once you leave the field. */
function DurationCell({ seconds, onValue, label }: { seconds: number; onValue: (n: number) => void; label: string }) {
  const show = (n: number) => (n ? formatDuration(n) : '');
  const [text, setText] = useState(show(seconds));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(show(seconds));
  }, [seconds]);
  return (
    <input
      class="input num"
      inputMode="text"
      autocomplete="off"
      aria-label={label}
      placeholder="0:00"
      value={text}
      onFocus={(e) => {
        focused.current = true;
        (e.target as HTMLInputElement).select();
      }}
      onBlur={() => {
        focused.current = false;
        setText(show(seconds));
      }}
      onInput={(e) => {
        const v = (e.target as HTMLInputElement).value;
        setText(v);
        const n = v.trim() === '' ? 0 : parseDuration(v);
        if (n !== null) onValue(n);
      }}
    />
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
