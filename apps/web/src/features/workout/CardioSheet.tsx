import { useEffect, useMemo, useState } from 'preact/hooks';
import { Button, Field, Icon, LinkButton, List, ListRow, Notice, SectionTitle, Sheet, TextInput } from '../../ui';
import { ACTIVITIES, type Activity } from '@fitwell/core/data/activities';
import { customActivitiesRepo, recentRefs } from '../../db/workoutStore';
import type { Workout } from '@fitwell/core/schema';
import { parseAmount } from '@fitwell/core/domain/nutrition';
import { estimateKcal } from '@fitwell/core/domain/met';
import { displayDistance, distanceUnit, toKm } from '@fitwell/core/domain/units';
import { cardioKcal } from '@fitwell/core/domain/workouts';
import { prepare, search } from '@fitwell/core/search/rank';
import { currentWeightKg, settings } from '../../state';
import { t } from '../../i18n';
import { createCardio, deleteWorkout, saveAsTemplate, updateCardio } from './actions';
import { TemplateSheet } from './StrengthPage';
import { showToast } from '../food/toast';

interface Pick { ref: string; name: string; met: number }
/** Shown before "Show all": what most people log. */
const COMMON = ['act:walk-moderate', 'act:run-10', 'act:bike-moderate', 'act:swim-light', 'act:yoga', 'act:strength-light'];
const fromActivity = (a: Activity): Pick => ({ ref: a.id, name: a.name, met: a.met });

function CustomActivityForm({ initialName, onCreated, onBack }: { initialName: string; onCreated: (p: Pick) => void; onBack: () => void }) {
  const [name, setName] = useState(initialName);
  const [met, setMet] = useState('');
  const [errors, setErrors] = useState<{ name?: string; met?: string }>({});
  return (
    <form
      class="stack gap-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const m = parseAmount(met);
        const errs: typeof errors = {};
        if (!name.trim()) errs.name = t('exercise.nameError');
        if (m === null || m < 1 || m > 25) errs.met = t('activity.metError');
        setErrors(errs);
        if (errs.name || errs.met) return;
        const rec = await customActivitiesRepo.create({ name: name.trim(), met: m! });
        onCreated({ ref: `ca:${rec.id}`, name: rec.name, met: rec.met });
      }}
    >
      <Field label={t('exercise.name')} error={errors.name}>{(c) => <TextInput {...c} autocomplete="off" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />}</Field>
      <Field label={t('activity.met')} hint={t('activity.metHint')} error={errors.met}>
        {(c) => <TextInput {...c} inputMode="decimal" autocomplete="off" value={met} onInput={(e) => setMet((e.target as HTMLInputElement).value)} />}
      </Field>
      <div class="cluster between">
        <Button onClick={onBack}>{t('common.back')}</Button>
        <Button type="submit" variant="primary">{t('exercise.save')}</Button>
      </div>
    </form>
  );
}

/** Add or edit a cardio / activity entry: pick an activity, enter time (and distance), see an energy estimate. */
export function CardioSheet({ day, existing, preset, onClose, onSaved }: { day: string; existing?: Workout; preset?: Pick; onClose: () => void; onSaved?: () => void }) {
  const units = settings.value.units;
  const habitOnly = settings.value.habitOnly;
  const c0 = existing?.cardio;
  const [activity, setActivity] = useState<Pick | null>(c0 ? { ref: c0.activityRef, name: c0.activityName, met: c0.met } : (preset ?? null));
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [mine, setMine] = useState<Pick[]>([]);
  const [recent, setRecent] = useState<{ ref: string; name: string }[]>([]);
  const [minutes, setMinutes] = useState(c0 ? String(c0.durationMin) : '30');
  const [distance, setDistance] = useState(c0?.distanceKm ? String(displayDistance(c0.distanceKm, units)) : '');
  const [own, setOwn] = useState(c0?.kcalOverride !== undefined ? String(c0.kcalOverride) : '');
  const [errors, setErrors] = useState<{ minutes?: string; distance?: string; own?: string }>({});
  const [templating, setTemplating] = useState(false);

  useEffect(() => {
    void customActivitiesRepo.list().then((l) => setMine(l.sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ ref: `ca:${c.id}`, name: c.name, met: c.met }))));
    void recentRefs('activity', 6).then(setRecent);
  }, []);

  const all = useMemo(() => [...mine, ...ACTIVITIES.map(fromActivity)], [mine]);
  const index = useMemo(() => prepare(all, (a) => a.name), [all]);
  const byRef = useMemo(() => new Map(all.map((a) => [a.ref, a])), [all]);

  const mins = parseAmount(minutes);
  const weight = currentWeightKg();
  const estimate = activity && mins ? estimateKcal(activity.met, weight, mins) : undefined;

  // ---- step 1: choose an activity ----
  if (!activity) {
    const q = query.trim();
    const hits = q ? search(index, q, 30) : [];
    const row = (a: Pick) => <ListRow key={a.ref} main={a.name} onClick={() => setActivity(a)} />;
    const groups = [...new Set(ACTIVITIES.map((a) => a.group))];
    return (
      <Sheet
        title={creating ? t('activity.create') : t('activity.choose')}
        onClose={onClose}
        tall={!creating}
        pinned={
          creating ? undefined : (
            <div class="mt-2">
              <Field label={t('activity.search')} labelHidden>
                {(c) => <TextInput {...c} type="search" enterkeyhint="search" autocomplete="off" autofocus placeholder={t('activity.searchPlaceholder')} value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />}
              </Field>
            </div>
          )
        }
      >
        {creating ? (
          <CustomActivityForm initialName={query} onBack={() => setCreating(false)} onCreated={setActivity} />
        ) : (
          <>
            {q ? (
              <section aria-label={t('exercise.results')}>
                <SectionTitle>{t('exercise.results')}</SectionTitle>
                {hits.length ? <List>{hits.map(row)}</List> : <p class="muted">{t('exercise.noMatch')}</p>}
              </section>
            ) : (
              <>
                {recent.length > 0 && (
                  <section aria-label={t('food.recent')}>
                    <SectionTitle>{t('food.recent')}</SectionTitle>
                    <List>{recent.map((r) => row(byRef.get(r.ref) ?? { ref: r.ref, name: r.name, met: 4 }))}</List>
                  </section>
                )}
                {mine.length > 0 && (
                  <section aria-label={t('exercise.yours')}>
                    <SectionTitle>{t('exercise.yours')}</SectionTitle>
                    <List>{mine.map(row)}</List>
                  </section>
                )}
                {!showAll && (
                  <section aria-label={t('activity.common')}>
                    <SectionTitle>{t('activity.common')}</SectionTitle>
                    <List>{COMMON.filter((ref) => !recent.some((r) => r.ref === ref)).map((ref) => byRef.get(ref)).filter((a): a is Pick => !!a).map(row)}</List>
                    <Button block variant="ghost" class="mt-2" onClick={() => setShowAll(true)}>{t('activity.showAll')}</Button>
                  </section>
                )}
                {showAll &&
                  groups.map((g) => (
                    <section key={g} aria-label={g}>
                      <SectionTitle>{g}</SectionTitle>
                      <List>{ACTIVITIES.filter((a) => a.group === g).map((a) => row(fromActivity(a)))}</List>
                    </section>
                  ))}
              </>
            )}
            <Button block class="mt-4" onClick={() => setCreating(true)}>
              <Icon name="plus" size="sm" />{t('activity.create')}
            </Button>
            <p class="t-caption mt-3">{t('activity.credit')}</p>
          </>
        )}
      </Sheet>
    );
  }

  // ---- step 2: details ----
  async function save() {
    const errs: typeof errors = {};
    const m = parseAmount(minutes);
    if (!m || m <= 0) errs.minutes = t('workout.minutesError');
    const d = distance.trim() === '' ? undefined : parseAmount(distance);
    if (d === null) errs.distance = t('custom.numberError');
    const k = own.trim() === '' ? undefined : parseAmount(own);
    if (k === null) errs.own = t('custom.numberError');
    setErrors(errs);
    if (errs.minutes || errs.distance || errs.own) return;
    const input = { activityRef: activity!.ref, activityName: activity!.name, met: activity!.met, durationMin: m!, distanceKm: d ? toKm(d, units) : undefined, kcalOverride: k ?? undefined };
    if (existing) await updateCardio(existing, input);
    else await createCardio(day, input);
    if (onSaved) onSaved();
    else onClose();
  }

  const dUnit = distanceUnit(units);
  return (
    <Sheet title={activity.name} onClose={onClose}>
      <form class="stack gap-3" noValidate onSubmit={(e) => (e.preventDefault(), void save())}>
        {!existing && <LinkChange onClick={() => setActivity(null)} />}
        <Field label={t('workout.minutes')} error={errors.minutes}>
          {(c) => <TextInput {...c} inputMode="decimal" autocomplete="off" autofocus value={minutes} onInput={(e) => (setMinutes((e.target as HTMLInputElement).value), setErrors({}))} onFocus={(e) => (e.target as HTMLInputElement).select()} />}
        </Field>
        <div class="quick" role="group" aria-label={t('food.quick')}>
          {[15, 30, 45, 60, 90].map((n) => <Button key={n} size="sm" aria-pressed={mins === n} onClick={() => setMinutes(String(n))}>{n}</Button>)}
        </div>
        <Field label={`${t('workout.distance')} (${dUnit})`} hint={t('exercise.optional')} error={errors.distance}>
          {(c) => <TextInput {...c} inputMode="decimal" autocomplete="off" value={distance} onInput={(e) => (setDistance((e.target as HTMLInputElement).value), setErrors({}))} />}
        </Field>
        {!habitOnly && (
          <>
            {estimate !== undefined ? (
              <p class="t-caption" role="status">{`${t('workout.estimate')} ≈ ${estimate} ${t('unit.kcal')}`}. {t('workout.estimateHow')}</p>
            ) : (
              <Notice quiet>{t('workout.noWeight')}</Notice>
            )}
            <Field label={`${t('workout.ownKcal')} (${t('unit.kcal')})`} hint={t('exercise.optional')} error={errors.own}>
              {(c) => <TextInput {...c} inputMode="decimal" autocomplete="off" value={own} onInput={(e) => (setOwn((e.target as HTMLInputElement).value), setErrors({}))} />}
            </Field>
          </>
        )}
        <div class="sticky-action">
          <Button type="submit" variant="primary" block>{existing ? t('common.save') : t('workout.add')}</Button>
        </div>
      </form>
      {existing && (
        <div class="cluster between mt-3">
          <LinkButton class="small" onClick={() => setTemplating(true)}>{t('workout.saveTemplate')}</LinkButton>
          <LinkButton
            class="small danger"
            onClick={async () => {
              await deleteWorkout(existing);
              onClose();
            }}
          >
            <Icon name="trash" size="sm" />{t('food.remove')}
          </LinkButton>
        </div>
      )}
      {templating && existing && (
        <TemplateSheet
          initial={existing.cardio?.activityName}
          onClose={() => setTemplating(false)}
          onSave={async (name) => {
            await saveAsTemplate(existing, name);
            setTemplating(false);
            showToast(t('workout.templateSaved'));
          }}
        />
      )}
    </Sheet>
  );
}

function LinkChange({ onClick }: { onClick: () => void }) {
  return <LinkButton class="small align-start" onClick={onClick}>{t('activity.change')}</LinkButton>;
}

export { cardioKcal };
