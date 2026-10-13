import { useEffect, useState } from 'preact/hooks';
import { Button, Icon, List, ListRow, SectionTitle, Sheet } from '../../ui';
import { lastWorkout, templatesRepo } from '../../db/workoutStore';
import type { Workout, WorkoutTemplate } from '../../db/schema';
import { formatDay } from '../../domain/dates';
import { describeWorkout } from '../../domain/workouts';
import { t } from '../../i18n';
import { createStrength, deleteTemplate, repeatWorkout, startFromTemplate } from './actions';
import { CardioSheet } from './CardioSheet';

/** One tap to start: strength, cardio, repeat the last one, or begin from a saved template. */
export function AddWorkoutSheet({ day, onClose }: { day: string; onClose: () => void }) {
  const [cardio, setCardio] = useState(false);
  const [lastS, setLastS] = useState<Workout | undefined>();
  const [lastC, setLastC] = useState<Workout | undefined>();
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);

  const load = () => {
    void lastWorkout('strength').then(setLastS);
    void lastWorkout('cardio').then(setLastC);
    void templatesRepo.list().then((l) => setTemplates(l.sort((a, b) => a.name.localeCompare(b.name))));
  };
  useEffect(load, []);

  if (cardio) return <CardioSheet day={day} onClose={onClose} />;

  const open = (w: Workout) => {
    onClose();
    if (w.type === 'strength') location.hash = `#/workout/${w.id}`;
  };
  const summary = (w: Workout) => {
    const d = describeWorkout(w);
    return `${d.title} · ${d.detail} · ${formatDay(w.day, { month: 'short', day: 'numeric' })}`;
  };

  return (
    <Sheet title={t('workout.add')} onClose={onClose}>
      <div class="stack gap-3">
        <Button
          variant="primary"
          block
          onClick={async () => {
            const w = await createStrength(day);
            open(w);
          }}
        >
          <Icon name="plus" size="sm" />{t('workout.newStrength')}
        </Button>
        <Button block onClick={() => setCardio(true)}>
          <Icon name="plus" size="sm" />{t('workout.newCardio')}
        </Button>

        {(lastS || lastC) && (
          <section aria-label={t('workout.repeat')}>
            <SectionTitle>{t('workout.repeat')}</SectionTitle>
            <List>
              {lastS && <ListRow main={t('workout.repeatStrength')} sub={summary(lastS)} onClick={async () => open(await repeatWorkout(day, lastS))} />}
              {lastC && (
                <ListRow
                  main={t('workout.repeatCardio')}
                  sub={summary(lastC)}
                  onClick={async () => {
                    await repeatWorkout(day, lastC);
                    onClose();
                  }}
                />
              )}
            </List>
          </section>
        )}

        {templates.length > 0 && (
          <section aria-label={t('workout.templates')}>
            <SectionTitle>{t('workout.templates')}</SectionTitle>
            <List>
              {templates.map((tpl) => (
                <li key={tpl.id} class="row-split">
                  <button
                    type="button"
                    class="row"
                    onClick={async () => {
                      const w = await startFromTemplate(day, tpl);
                      if (w.type === 'strength') open(w);
                      else onClose();
                    }}
                  >
                    <span class="row-main">{tpl.name}</span>
                    <span class="row-sub">{tpl.type === 'cardio' ? `${tpl.cardio?.activityName ?? ''} · ${Math.round(tpl.cardio?.durationMin ?? 0)} min` : `${tpl.exercises?.length ?? 0} ${t('workout.exercisesWord')}`}</span>
                  </button>
                  <Button
                    icon
                    aria-label={`${t('workout.deleteTemplate')} ${tpl.name}`}
                    onClick={async () => {
                      await deleteTemplate(tpl);
                      load();
                    }}
                  >
                    <Icon name="trash" size="sm" />
                  </Button>
                </li>
              ))}
            </List>
          </section>
        )}
      </div>
    </Sheet>
  );
}
