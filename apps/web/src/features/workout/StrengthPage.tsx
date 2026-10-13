import { useEffect, useRef, useState } from 'preact/hooks';
import { Badge, Button, Card, Choice, EmptyState, Field, Icon, LinkButton, Menu, Meter, Screen, Segmented, Sheet, TextInput } from '../../ui';
import { lastPerformance, workoutsRepo } from '../../db/workoutStore';
import type { Workout, WorkoutExercise, WorkoutSet } from '@fitwell/core/schema';
import { formatDay, today } from '@fitwell/core/domain/dates';
import { displayWeight, toKg, weightUnit } from '@fitwell/core/domain/units';
import { addedLoadKg, elapsedSeconds, formatClock, formatDuration, formatMinutes, isSetDone, newSet, normalizeSupersets, parseDuration, plannedSets, sessionMinutes, suggestNextKg, summarizeSets, supersetPosition, workoutStatus, workoutTally } from '@fitwell/core/domain/workouts';
import { routeId } from '../../router';
import { currentWeightKg, settings } from '../../state';
import { t } from '../../i18n';
import { deleteWorkout, finishWorkout, newId, reopenWorkout, saveAsTemplate, startWorkout } from './actions';
import { ExercisePicker, HowToSteps } from './ExercisePicker';
import { ExerciseThumb } from './ExerciseFigure';
import { NumberCell } from './NumberCell';
import { showToast } from '../food/toast';

interface Last { summary: string; day: string; sets: WorkoutSet[]; first?: Pick<WorkoutSet, 'reps' | 'weightKg' | 'durationSec' | 'bodyweightKg'>; mode?: 'reps' | 'time'; load?: 'weight' | 'bodyweight' }

const REST_KEY = 'fitwell-rest-seconds';
const restDefault = () => {
  try {
    const n = Number(localStorage.getItem(REST_KEY));
    return n >= 15 && n <= 600 ? n : 90;
  } catch {
    return 90;
  }
};
const rememberRest = (sec: number) => {
  try {
    localStorage.setItem(REST_KEY, String(sec));
  } catch {
    /* fine: the default comes back next time */
  }
};

/**
 * Strength workout: exercises → sets (weight, reps or time, warm-up or working). Every change is saved as you go.
 * Sets prefilled from last time are planned (muted) until ticked or edited; ticking starts a rest timer.
 */
export function StrengthPage() {
  const id = routeId.value!;
  const units = settings.value.units;
  const [w, setW] = useState<Workout | null | 'missing'>(null);
  const [picking, setPicking] = useState(false);
  const [templating, setTemplating] = useState(false);
  const [sheet, setSheet] = useState<{ kind: 'options' | 'howto'; uid: string } | null>(null);
  const [last, setLast] = useState<Record<string, Last | null>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState<{ setId: string; uid: string; startedAt: number } | null>(null);
  const [rest, setRest] = useState<{ until: number; total: number } | null>(null);
  const [finishing, setFinishing] = useState(false);
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

  // One clock for the stopwatch, the rest timer and the workout timer. Faster while something is counting.
  const ticking = !!w && w !== 'missing' && workoutStatus(w) === 'active';
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), running || rest ? 250 : ticking ? 1000 : 30_000);
    return () => clearInterval(i);
  }, [!!running, !!rest, ticking]);

  // Rest is over: a short buzz where the device can, then the timer clears itself.
  useEffect(() => {
    if (!rest || now < rest.until) return;
    try {
      navigator.vibrate?.([120, 80, 120]);
    } catch {
      /* not supported: the footer says it too */
    }
    showToast(t('workout.restOver'));
    setRest(null);
  }, [now, rest]);

  // "Last time" for each exercise in this workout.
  useEffect(() => {
    if (!w || w === 'missing') return;
    for (const e of w.exercises ?? []) {
      if (e.exerciseRef in last) continue;
      setLast((l) => ({ ...l, [e.exerciseRef]: null }));
      void lastPerformance(e.exerciseRef, w).then((r) => {
        const working = r?.exercise.sets.filter((s) => s.type === 'working' && isSetDone(s) && (s.reps > 0 || (s.durationSec ?? 0) > 0)) ?? [];
        setLast((l) => ({
          ...l,
          [e.exerciseRef]: r ? { summary: summarizeSets(r.exercise.sets, units, r.exercise), day: r.workout.day, sets: r.exercise.sets, first: working[0], mode: r.exercise.mode, load: r.exercise.load } : null,
        }));
      });
    }
  }, [w && w !== 'missing' ? w.exercises?.map((e) => e.exerciseRef).join(',') : '', w && w !== 'missing' ? w.id : '']);

  const dayHash = (day: string) => (day === today() ? '#/today' : `#/today/${day}`);
  const backLabel = t('workout.backToDay');

  if (w === null) return <Screen title={t('workout.strength')}><p class="muted" role="status">{t('common.loading')}</p></Screen>;
  if (w === 'missing') {
    return (
      <Screen title={t('workout.strength')} back={{ label: backLabel, onBack: () => (location.hash = '#/today') }}>
        <EmptyState>{t('workout.missing')}</EmptyState>
        <Button onClick={() => (location.hash = '#/today')}>{t('review.back')}</Button>
      </Screen>
    );
  }

  const exercises = w.exercises ?? [];
  const status = workoutStatus(w);
  const locked = status === 'finished'; // closed: nothing can be added or changed unless it is reopened
  const active = status === 'active';
  const commit = (next: WorkoutExercise[]) => {
    if (locked) return;
    setW({ ...w, exercises: next });
    latest.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 300);
  };
  const edit = (ei: number, fn: (e: WorkoutExercise) => WorkoutExercise) => commit(exercises.map((e, i) => (i === ei ? fn(e) : e)));
  const unit = weightUnit(units);
  const bodyKg = () => currentWeightKg() ?? 0;
  const tally = workoutTally(exercises);
  const planned = plannedSets(exercises);
  const clock = active ? formatClock(elapsedSeconds(w, now) ?? 0) : undefined;
  const tookMin = sessionMinutes(w);
  const volumeText = tally.volumeKg > 0 ? `${Math.round(displayWeight(tally.volumeKg, units)).toLocaleString()} ${unit}` : '';
  const setsText = tally.total ? t('workout.setsDone').replace('{done}', String(tally.done)).replace('{total}', String(tally.total)) : '';
  const leave = () => {
    flush();
    location.hash = dayHash(w.day);
  };

  async function begin() {
    flush();
    const u = await startWorkout(w as Workout);
    setW({ ...(w as Workout), startedAt: u.startedAt });
    setNow(Date.now());
  }
  async function finish() {
    flush();
    const u = await finishWorkout(w as Workout, exercises);
    const took = sessionMinutes(u);
    showToast(t('workout.finished').replace('{sets}', `${tally.done} ${tally.done === 1 ? t('workout.setOne') : t('workout.sets')}`) + (took !== undefined ? ` · ${formatMinutes(took)}` : ''));
    location.hash = dayHash((w as Workout).day);
  }
  async function reopen() {
    const u = await reopenWorkout(w as Workout);
    setW({ ...(w as Workout), startedAt: u.startedAt, finishedAt: undefined });
    setNow(Date.now());
  }
  /** Finish asks first when it would throw something away: sets never done, or a workout with nothing done at all. */
  const onFinish = () => (tally.done === 0 || planned > 0 ? setFinishing(true) : void finish());

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
    if (ei >= 0) edit(ei, (e) => ({ ...e, sets: e.sets.map((x) => (x.id === running.setId ? { ...x, durationSec: secs, done: true } : x)) }));
  }

  function startRest(sec = rest?.total ?? restDefault()) {
    setNow(Date.now());
    setRest({ until: Date.now() + sec * 1000, total: sec });
  }
  function adjustRest(by: number) {
    if (!rest) return;
    const total = Math.min(600, Math.max(15, rest.total + by));
    rememberRest(total);
    setRest({ until: Math.max(Date.now() + 1000, rest.until + by * 1000), total });
  }

  async function addExercise(ex: { ref: string; name: string }) {
    setPicking(false);
    const prev = await lastPerformance(ex.ref, w as Workout);
    const first = prev?.exercise.sets.find((s) => s.type === 'working' && isSetDone(s) && (s.reps > 0 || (s.durationSec ?? 0) > 0));
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
          const rest_ = { ...x };
          delete rest_.bodyweightKg;
          return load === 'bodyweight' ? { ...rest_, weightKg: bw, bodyweightKg: bw } : { ...rest_, weightKg: 0 };
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

  const sheetEx = sheet ? exercises.find((e) => e.uid === sheet.uid) : undefined;
  const sheetEi = sheetEx ? exercises.indexOf(sheetEx) : -1;
  const statusParts = [clock ?? '', setsText, volumeText].filter(Boolean);

  return (
    <Screen
      title={w.name?.trim() || t('workout.strength')}
      subtitle={formatDay(w.day)}
      onSubtitle={leave}
      subtitleAction={t('workout.openDay')}
      back={{ label: backLabel, onBack: leave }}
    >
      {active && (
        <Card label={t('workout.inProgress')} compact class="live-card">
          <div class="stack gap-2">
            <p class="t-overline">{t('workout.inProgress')}</p>
            <p class="t-stat clock-big">{clock}</p>
            {tally.total > 0 && <Meter value={tally.done / tally.total} />}
            <p class="t-caption">{[setsText, volumeText].filter(Boolean).join(' · ') || t('workout.noSetsYet')}</p>
          </div>
        </Card>
      )}
      {locked && (
        <Card labelledBy="done-h" compact class="live-card">
          <div class="stack gap-2">
            <h2 id="done-h" class="card-title"><Icon name="check" size="sm" /> {t('workout.finishedTitle')}</h2>
            <p>{[tookMin !== undefined ? formatMinutes(tookMin) : '', `${tally.done} ${tally.done === 1 ? t('workout.setOne') : t('workout.sets')}`, volumeText].filter(Boolean).join(' · ')}</p>
            <p class="t-caption">{t('workout.finishedHelp')}</p>
            <Button variant="ghost" size="sm" class="align-start" onClick={() => void reopen()}>{t('workout.reopen')}</Button>
          </div>
        </Card>
      )}
      {exercises.length === 0 && !locked && <EmptyState>{t('workout.emptyStrength')}</EmptyState>}

      {exercises.map((ex, ei) => {
        const uid = ex.uid!;
        const l = last[ex.exerciseRef];
        const isTime = ex.mode === 'time';
        const isBw = ex.load === 'bodyweight';
        const pos = supersetPosition(exercises, ei);
        const isCollapsed = collapsed.has(uid);
        const today_ = summarizeSets(ex.sets, units, ex);
        const suggestion = !isTime && !isBw && l ? suggestNextKg(l.sets, units) : undefined;
        const plannedWorking = ex.sets.some((s) => s.type === 'working' && s.done === false && Math.abs(s.weightKg - (suggestion ?? -1)) > 0.01);
        let workingNo = 0;
        return (
          <Card key={uid} labelledBy={`ex-${uid}`} class={pos ? `exercise superset${pos.first ? ' first' : ''}${pos.last ? ' last' : ''}` : 'exercise'}>
            <div class="stack gap-3">
              <div class="ex-head">
                <button
                  type="button"
                  class="ex-toggle"
                  aria-expanded={!isCollapsed}
                  aria-controls={`ex-body-${uid}`}
                  onClick={() => setCollapsedFor(uid, !isCollapsed)}
                >
                  <ExerciseThumb name={ex.exerciseName} small />
                  <span class="ex-title">
                    <h2 id={`ex-${uid}`} class="ex-name">{ex.exerciseName}</h2>
                    {isCollapsed && <span class="t-caption">{today_ || t('workout.noSetsYet')}</span>}
                  </span>
                  <span class={isCollapsed ? 'chev' : 'chev open'}><Icon name="expand" size="sm" /></span>
                </button>
                {(!locked || ex.exerciseRef.startsWith('ex:')) && (
                  <Menu
                    label={`${t('workout.exerciseMenu')}: ${ex.exerciseName}`}
                    items={[
                      ...(locked ? [] : [{ label: t('workout.options'), icon: 'settings' as const, onSelect: () => setSheet({ kind: 'options', uid }) }]),
                      ...(ex.exerciseRef.startsWith('ex:') ? [{ label: t('exercise.howTo'), icon: 'info' as const, onSelect: () => setSheet({ kind: 'howto', uid }) }] : []),
                      ...(locked ? [] : [{ label: t('workout.removeExercise'), icon: 'trash' as const, danger: true, onSelect: () => removeExercise(ei) }]),
                    ]}
                  />
                )}
              </div>
              {pos && <p class="t-caption"><Badge tone="neutral">{t('workout.superset')} {pos.letter.charCodeAt(0) - 64} {t('workout.of')} {pos.size}</Badge></p>}
              <div id={`ex-body-${uid}`} class="stack gap-3" hidden={isCollapsed}>
                {l?.summary && (
                  <div class="last-time">
                    <p class="t-caption">
                      <Badge tone="neutral">{t('workout.lastTime')}</Badge> {l.summary} · {formatDay(l.day, { month: 'short', day: 'numeric' })}
                    </p>
                    {!locked && suggestion !== undefined && plannedWorking && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => edit(ei, (e) => ({ ...e, sets: e.sets.map((x) => (x.type === 'working' && x.done === false ? { ...x, weightKg: suggestion } : x)) }))}
                      >
                        {t('workout.tryNext').replace('{w}', `${displayWeight(suggestion, units, 2)} ${unit}`)}
                      </Button>
                    )}
                  </div>
                )}
                <div class={isTime ? 'set-grid timed' : 'set-grid'} role="group" aria-label={`${ex.exerciseName}: ${t('workout.sets')}`}>
                  <span class="t-overline">{t('workout.set')}</span>
                  <span class="t-overline">{isBw ? `+ ${unit}` : unit}</span>
                  <span class="t-overline">{isTime ? t('workout.time') : t('workout.reps')}</span>
                  <span class="t-overline">{t('workout.doneCol')}</span>
                  {ex.sets.map((s, si) => {
                    if (s.type === 'working') workingNo++;
                    const label = s.type === 'warmup' ? t('workout.warmupShort') : String(workingNo);
                    const setName = `${t('workout.set')} ${si + 1}`;
                    const live = running?.setId === s.id;
                    const done = isSetDone(s);
                    // Typing a value is logging it: the set counts from then on.
                    const patch = (p: Partial<WorkoutSet>) => edit(ei, (e) => ({ ...e, sets: e.sets.map((x) => (x.id === s.id ? { ...x, ...p } : x)) }));
                    return (
                      <div class={done ? 'set-row' : 'set-row planned'} key={s.id}>
                        {locked ? (
                          <span class={s.type === 'warmup' ? 'set-type warmup' : 'set-type'} role="img" aria-label={`${setName}: ${s.type === 'warmup' ? t('workout.warmup') : t('workout.working')}`}>{label}</span>
                        ) : (
                          <Menu
                            label={`${setName}: ${s.type === 'warmup' ? t('workout.warmup') : t('workout.working')}. ${t('workout.setMenu')}`}
                            buttonClass={s.type === 'warmup' ? 'set-type warmup' : 'set-type'}
                            items={[
                              s.type === 'warmup'
                                ? { label: t('workout.makeWorking'), onSelect: () => patch({ type: 'working' }) }
                                : { label: t('workout.makeWarmup'), onSelect: () => patch({ type: 'warmup' }) },
                              { label: t('workout.removeSet'), icon: 'trash', danger: true, onSelect: () => edit(ei, (e) => ({ ...e, sets: e.sets.filter((x) => x.id !== s.id) })) },
                            ]}
                          >
                            {label}
                          </Menu>
                        )}
                        <NumberCell
                          label={`${setName} ${isBw ? t('workout.addedLoad') : ''} ${unit}`.replace('  ', ' ')}
                          value={displayWeight(isBw ? addedLoadKg(s) : s.weightKg, units, 2)}
                          placeholder={isBw ? 'BW' : '0'}
                          planned={!done}
                          readOnly={locked}
                          onValue={(n) => patch({ ...(isBw ? { bodyweightKg: s.bodyweightKg ?? bodyKg(), weightKg: (s.bodyweightKg ?? bodyKg()) + toKg(n, units) } : { weightKg: toKg(n, units) }), done: true })}
                        />
                        {isTime ? (
                          <DurationCell label={`${setName} ${t('workout.time')}`} planned={!done} readOnly={locked} seconds={live ? Math.round((now - running!.startedAt) / 1000) : (s.durationSec ?? 0)} onValue={(n) => patch({ durationSec: n, done: true })} />
                        ) : (
                          <NumberCell label={`${setName} ${t('workout.reps')}`} value={s.reps} placeholder="0" planned={!done} readOnly={locked} onValue={(n) => patch({ reps: n, done: true })} />
                        )}
                        <button
                          type="button"
                          class="set-done"
                          disabled={locked}
                          aria-pressed={done}
                          aria-label={`${setName}: ${t('workout.markDone')}`}
                          onClick={() => {
                            patch({ done: !done });
                            if (!done) startRest();
                          }}
                        >
                          <Icon name="check" />
                        </button>
                        {isTime && !locked && (
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
                {!locked && (
                <Button
                  block
                  variant="ghost"
                  onClick={() => {
                    const group = pos ? exercises.map((e, i) => (supersetPosition(exercises, i) && e.supersetId === ex.supersetId ? i : -1)).filter((i) => i >= 0) : [ei];
                    commit(exercises.map((e, i) => (group.includes(i) ? addSetTo(e, last[e.exerciseRef]) : e)));
                  }}
                >
                  <Icon name="plus" size="sm" />{pos ? t('workout.addRound') : t('workout.addSet')}
                </Button>
                )}
              </div>
            </div>
          </Card>
        );
      })}

      {exercises.length > 0 && (
        <div class="cluster between">
          <LinkButton class="small" onClick={() => setTemplating(true)}>{t('workout.saveTemplate')}</LinkButton>
          <LinkButton
            class="small danger"
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

      {locked ? (
        <div class="primary-bar workout-bar">
          <Button variant="primary" size="lg" block onClick={leave}><Icon name="back" />{t('workout.backToDay')}</Button>
        </div>
      ) : (
        <div class="primary-bar workout-bar">
          {(rest || statusParts.length > 0) && (
            <div class="workout-status" role={rest ? 'timer' : undefined} aria-live="off">
              {rest ? (
                <>
                  <Icon name="timer" size="sm" />
                  <span class="grow">{t('workout.rest')} <strong>{formatDuration(Math.max(0, Math.ceil((rest.until - now) / 1000)))}</strong></span>
                  <Button size="sm" variant="ghost" onClick={() => adjustRest(-15)} aria-label={t('workout.restLess')}>−15</Button>
                  <Button size="sm" variant="ghost" onClick={() => adjustRest(15)} aria-label={t('workout.restMore')}>+15</Button>
                  <Button size="sm" variant="ghost" onClick={() => setRest(null)}>{t('workout.restSkip')}</Button>
                </>
              ) : (
                <span>{statusParts.join(' · ')}</span>
              )}
            </div>
          )}
          <div class="workout-actions">
            <Button variant={exercises.length ? 'secondary' : 'primary'} size="lg" class="grow" onClick={() => setPicking(true)}>
              <Icon name="plus" />{t('exercise.add')}
            </Button>
            {exercises.length > 0 && status === 'open' && w.day === today() && (
              <Button variant="primary" size="lg" onClick={() => void begin()}>
                <Icon name="play" />{t('workout.start')}
              </Button>
            )}
            {exercises.length > 0 && (active || (status === 'open' && w.day !== today())) && (
              <Button variant="primary" size="lg" onClick={onFinish}>
                <Icon name="finish" />{t('workout.finish')}
              </Button>
            )}
          </div>
        </div>
      )}

      {finishing && (
        <Sheet title={tally.done === 0 ? t('workout.nothingDone') : t('workout.finishAsk')} onClose={() => setFinishing(false)}>
          <div class="stack gap-3">
            <p>{tally.done === 0 ? t('workout.nothingDone.body') : planned === 1 ? t('workout.finishUnfinished.one') : t('workout.finishUnfinished').replace('{n}', String(planned))}</p>
            {tally.done === 0 ? (
              <>
                <Button variant="primary" block onClick={() => setFinishing(false)}>{t('workout.keepGoing')}</Button>
                <LinkButton
                  class="small danger align-start"
                  onClick={async () => {
                    flush();
                    await deleteWorkout(w);
                    location.hash = dayHash(w.day);
                  }}
                >
                  <Icon name="trash" size="sm" />{t('workout.discard')}
                </LinkButton>
              </>
            ) : (
              <>
                <Button variant="primary" block onClick={() => void finish()}>{t('workout.finish')}</Button>
                <Button block onClick={() => setFinishing(false)}>{t('workout.keepGoing')}</Button>
              </>
            )}
          </div>
        </Sheet>
      )}

      {picking && <ExercisePicker onClose={() => setPicking(false)} onPick={(e) => void addExercise({ ref: e.ref, name: e.name })} />}
      {sheet?.kind === 'options' && sheetEx && (
        <Sheet title={t('workout.options')} subtitle={sheetEx.exerciseName} onClose={() => setSheet(null)}>
          <div class="stack gap-4">
            <Segmented
              legend={t('workout.measureBy')}
              name={`mode-${sheetEx.uid}`}
              options={[{ value: 'reps', label: t('workout.repsOption') }, { value: 'time', label: t('workout.timeOption') }]}
              value={sheetEx.mode ?? 'reps'}
              onChange={(m) => edit(sheetEi, (e) => ({ ...e, mode: m }))}
            />
            <Segmented
              legend={t('workout.loadType')}
              name={`load-${sheetEx.uid}`}
              options={[{ value: 'weight', label: t('workout.weight') }, { value: 'bodyweight', label: t('workout.bodyweight') }]}
              value={sheetEx.load ?? 'weight'}
              onChange={(m) => setLoad(sheetEi, m)}
            />
            {sheetEi > 0 && (
              <Choice type="checkbox" checked={!!supersetPosition(exercises, sheetEi) && !supersetPosition(exercises, sheetEi)!.first} onChange={(on) => setLinked(sheetEi, on)} label={t('workout.supersetWithAbove')} help={t('workout.supersetHelp')} />
            )}
            <Button variant="primary" block onClick={() => setSheet(null)}>{t('common.done')}</Button>
          </div>
        </Sheet>
      )}
      {sheet?.kind === 'howto' && sheetEx && (
        <Sheet title={sheetEx.exerciseName} onClose={() => setSheet(null)}>
          <HowToSteps ex={{ ref: sheetEx.exerciseRef, name: sheetEx.exerciseName }} />
        </Sheet>
      )}
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
function DurationCell({ seconds, onValue, label, planned, readOnly }: { seconds: number; onValue: (n: number) => void; label: string; planned?: boolean; readOnly?: boolean }) {
  const show = (n: number) => (n ? formatDuration(n) : '');
  const [text, setText] = useState(show(seconds));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(show(seconds));
  }, [seconds]);
  return (
    <input
      class={planned ? 'input num planned' : 'input num'}
      inputMode="text"
      autocomplete="off"
      aria-label={label}
      readOnly={readOnly}
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
