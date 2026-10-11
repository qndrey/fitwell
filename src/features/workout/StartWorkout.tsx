import { useEffect, useState } from 'preact/hooks';
import { Button, EmptyState, Icon, LinkButton, List, ListRow, Notice, Screen, SectionTitle, Sheet } from '../../ui';
import { lastWorkout, templatesRepo } from '../../db/workoutStore';
import { onChange } from '../../db/broadcast';
import type { Workout, WorkoutTemplate } from '../../db/schema';
import { formatDay, today } from '../../domain/dates';
import { describeWorkout, summarizeSets } from '../../domain/workouts';
import { routeDay } from '../../router';
import { settings } from '../../state';
import { t } from '../../i18n';
import { createStrength, deleteTemplate, repeatWorkout, startFromTemplate } from './actions';
import { activeWorkout } from './active';
import { CardioSheet } from './CardioSheet';

const dayHash = (day: string) => (day === today() ? '#/today' : `#/today/${day}`);
const go = (id: string) => (location.hash = `#/workout/${id}`);

/** "5 exercises · Bench press, Squat, Row +2": what a saved workout holds, in one line. */
function templateLine(tpl: WorkoutTemplate): string {
  if (tpl.type === 'cardio') return `${tpl.cardio?.activityName ?? ''} · ${Math.round((tpl.cardio?.durationMin ?? 0) * 10) / 10} min`;
  const ex = tpl.exercises ?? [];
  const names = ex.slice(0, 3).map((e) => e.exerciseName).join(', ');
  return `${ex.length} ${ex.length === 1 ? t('workout.exerciseOne') : t('workout.exercisesWord')}${names ? ` · ${names}${ex.length > 3 ? ` +${ex.length - 3}` : ''}` : ''}`;
}

/**
 * Where a workout begins: start an empty one, log cardio, start one of your saved workouts, or repeat the last.
 * Workouts started for today get a timer; for another day they are logged without one.
 */
export function StartWorkout() {
  const day = routeDay.value ?? today();
  const units = settings.value.units;
  const [templates, setTemplates] = useState<WorkoutTemplate[] | null>(null);
  const [lastS, setLastS] = useState<Workout | undefined>();
  const [lastC, setLastC] = useState<Workout | undefined>();
  const [cardio, setCardio] = useState(false);
  const [preview, setPreview] = useState<WorkoutTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const running = activeWorkout.value;

  const load = () => {
    void lastWorkout('strength').then(setLastS);
    void lastWorkout('cardio').then(setLastC);
    void templatesRepo.list().then((l) => setTemplates(l.sort((a, b) => a.name.localeCompare(b.name))));
  };
  // Reload when anything changes (a saved workout deleted, restored by Undo, or saved elsewhere).
  useEffect(() => {
    load();
    return onChange((c) => (c.store === 'workoutTemplates' || c.store === 'workouts') && load());
  }, []);

  /** One start at a time: a double tap must not create two workouts. */
  async function begin(make: () => Promise<Workout>, then: (w: Workout) => void) {
    if (busy) return;
    setBusy(true);
    try {
      then(await make());
    } finally {
      setBusy(false);
    }
  }
  const startTemplate = (tpl: WorkoutTemplate) =>
    begin(() => startFromTemplate(day, tpl, true), (w) => (w.type === 'strength' ? go(w.id) : (location.hash = dayHash(day))));
  const summary = (w: Workout) => {
    const d = describeWorkout(w);
    return `${d.title} · ${d.detail} · ${formatDay(w.day, { month: 'short', day: 'numeric' })}`;
  };

  return (
    <Screen title={t('workout.startTitle')} subtitle={formatDay(day)} back={{ label: t('workout.backToDay'), onBack: () => (location.hash = dayHash(day)) }}>
      {running && (
        <Notice attention>
          <div class="cluster between">
            <span>{t('workout.alreadyRunning').replace('{name}', running.name?.trim() || t('workout.strength'))}</span>
            <Button size="sm" onClick={() => go(running.id)}>{t('workout.resume')}</Button>
          </div>
        </Notice>
      )}
      {day !== today() && <p class="t-caption">{t('workout.untimedDay')}</p>}

      <section class="stack gap-2" aria-label={t('workout.startNew')}>
        <SectionTitle>{t('workout.startNew')}</SectionTitle>
        <button type="button" class="start-card primary" aria-labelledby="start-s-title" aria-describedby="start-s-sub" disabled={busy} onClick={() => void begin(() => createStrength(day, [], undefined, true), (w) => go(w.id))}>
          <Icon name="strength" size="lg" />
          <span class="start-text">
            <span class="start-title" id="start-s-title">{t('workout.newStrength')}</span>
            <span class="start-sub" id="start-s-sub">{t('workout.newStrength.help')}</span>
          </span>
          <Icon name="next" />
        </button>
        <button type="button" class="start-card" aria-labelledby="start-c-title" aria-describedby="start-c-sub" onClick={() => setCardio(true)}>
          <Icon name="cardio" size="lg" />
          <span class="start-text">
            <span class="start-title" id="start-c-title">{t('workout.newCardio')}</span>
            <span class="start-sub" id="start-c-sub">{t('workout.newCardio.help')}</span>
          </span>
          <Icon name="next" />
        </button>
      </section>

      <section class="stack gap-2" aria-label={t('workout.saved')}>
        <SectionTitle>{t('workout.saved')}</SectionTitle>
        {templates === null ? (
          <p class="muted" role="status">{t('common.loading')}</p>
        ) : templates.length === 0 ? (
          <EmptyState>{t('workout.savedEmpty')}</EmptyState>
        ) : (
          <List>
            {templates.map((tpl) => (
              <ListRow
                key={tpl.id}
                main={tpl.name}
                sub={templateLine(tpl)}
                onClick={() => setPreview(tpl)}
                action={
                  <Button icon class="accent" disabled={busy} aria-label={`${t('workout.startSaved')} ${tpl.name}`} onClick={() => void startTemplate(tpl)}>
                    <Icon name="play" />
                  </Button>
                }
              />
            ))}
          </List>
        )}
      </section>

      {(lastS || lastC) && (
        <section class="stack gap-2" aria-label={t('workout.repeat')}>
          <SectionTitle>{t('workout.repeat')}</SectionTitle>
          <List>
            {lastS && <ListRow main={t('workout.repeatStrength')} sub={summary(lastS)} onClick={() => void begin(() => repeatWorkout(day, lastS, true), (w) => go(w.id))} />}
            {lastC && <ListRow main={t('workout.repeatCardio')} sub={summary(lastC)} onClick={() => void begin(() => repeatWorkout(day, lastC), () => (location.hash = dayHash(day)))} />}
          </List>
        </section>
      )}

      {cardio && <CardioSheet day={day} onClose={() => setCardio(false)} onSaved={() => (location.hash = dayHash(day))} />}
      {preview && (
        <Sheet title={preview.name} subtitle={templateLine(preview)} onClose={() => setPreview(null)}>
          <div class="stack gap-3">
            {preview.type === 'strength' && (
              <List>
                {(preview.exercises ?? []).map((e, i) => (
                  <ListRow key={i} main={e.exerciseName} sub={summarizeSets(e.sets, units, e) || `${e.sets.length} ${e.sets.length === 1 ? t('workout.setOne') : t('workout.sets')}`} />
                ))}
              </List>
            )}
            <Button
              variant="primary"
              block
              disabled={busy}
              onClick={async () => {
                await startTemplate(preview);
                setPreview(null);
              }}
            >
              <Icon name="play" size="sm" />{t('workout.startSaved')} {preview.name}
            </Button>
            <LinkButton
              class="small danger align-start"
              onClick={async () => {
                await deleteTemplate(preview);
                setPreview(null);
                load();
              }}
            >
              <Icon name="trash" size="sm" />{t('workout.deleteTemplate')}
            </LinkButton>
          </div>
        </Sheet>
      )}
    </Screen>
  );
}
