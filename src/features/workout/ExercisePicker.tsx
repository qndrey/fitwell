import { useEffect, useMemo, useState } from 'preact/hooks';
import { ExerciseFigure, ExerciseThumb } from './ExerciseFigure';
import { Button, Field, Icon, List, ListRow, SectionTitle, Select, Sheet, TextInput } from '../../ui';
import { customExercisesRepo, recentRefs } from '../../db/workoutStore';
import { fromCustom, loadExercises, loadInstructions, prepareExercises, searchExercises, type Exercise } from '../../data/exercises';
import { t } from '../../i18n';
import { newId } from './actions';

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function CustomExerciseForm({ initialName, muscles, equipment, onCreated, onBack }: { initialName: string; muscles: string[]; equipment: string[]; onCreated: (e: Exercise) => void; onBack: () => void }) {
  const [name, setName] = useState(initialName);
  const [muscle, setMuscle] = useState('');
  const [equip, setEquip] = useState('other');
  const [error, setError] = useState('');
  return (
    <form
      class="stack gap-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return setError(t('exercise.nameError'));
        const rec = await customExercisesRepo.create({ name: name.trim(), primary: muscle ? [muscle] : [], equipment: equip });
        onCreated(fromCustom(rec));
      }}
    >
      <Field label={t('exercise.name')} error={error}>
        {(c) => <TextInput {...c} autocomplete="off" value={name} onInput={(e) => (setName((e.target as HTMLInputElement).value), setError(''))} />}
      </Field>
      <Field label={t('exercise.muscle')} hint={t('exercise.optional')}>
        {(c) => (
          <Select {...c} value={muscle} onChange={(e) => setMuscle((e.target as HTMLSelectElement).value)}>
            <option value="">—</option>
            {muscles.map((m) => <option key={m} value={m}>{title(m)}</option>)}
          </Select>
        )}
      </Field>
      <Field label={t('exercise.equipment')}>
        {(c) => (
          <Select {...c} value={equip} onChange={(e) => setEquip((e.target as HTMLSelectElement).value)}>
            {equipment.map((m) => <option key={m} value={m}>{title(m)}</option>)}
          </Select>
        )}
      </Field>
      <div class="cluster between">
        <Button onClick={onBack}>{t('common.back')}</Button>
        <Button type="submit" variant="primary">{t('exercise.save')}</Button>
      </div>
    </form>
  );
}

/** The figure and the steps, loaded when shown: the body of the How-to sheet on the workout page. */
export function HowToSteps({ ex }: { ex: Pick<Exercise, 'ref' | 'name'> }) {
  const [steps, setSteps] = useState<string[] | null>(null);
  useEffect(() => void loadInstructions(ex.ref).then(setSteps), [ex.ref]);
  return (
    <div class="howto stack gap-3">
      {ex.ref.startsWith('ex:') && <ExerciseFigure name={ex.name} />}
      {steps === null ? <p class="muted" role="status">{t('common.loading')}</p> : steps.length ? <ol>{steps.map((s, i) => <li key={i}>{s}</li>)}</ol> : <p class="muted">{t('exercise.noSteps')}</p>}
    </div>
  );
}

function HowTo({ ex }: { ex: Exercise }) {
  const [steps, setSteps] = useState<string[] | null>(null);
  return (
    <details class="howto" onToggle={(e) => (e.target as HTMLDetailsElement).open && !steps && void loadInstructions(ex.ref).then(setSteps)}>
      <summary>{t('exercise.howTo')}</summary>
      {ex.ref.startsWith('ex:') && <ExerciseFigure name={ex.name} />}
      {steps && (steps.length ? <ol>{steps.map((s, i) => <li key={i}>{s}</li>)}</ol> : <p class="muted">{t('exercise.noSteps')}</p>)}
    </details>
  );
}

/** Search the library (offline), narrow by muscle or equipment, reuse recents, or add your own. */
export function ExercisePicker({ onPick, onClose }: { onPick: (e: Exercise) => void; onClose: () => void }) {
  const [lib, setLib] = useState<Awaited<ReturnType<typeof loadExercises>> | null>(null);
  const [mine, setMine] = useState<Exercise[]>([]);
  const [recent, setRecent] = useState<{ ref: string; name: string }[]>([]);
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState('');
  const [equip, setEquip] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void loadExercises().then(setLib);
    void customExercisesRepo.list().then((l) => setMine(l.sort((a, b) => a.name.localeCompare(b.name)).map(fromCustom)));
    void recentRefs('exercise', 8).then(setRecent);
  }, []);

  const all = useMemo(() => [...mine, ...(lib?.exercises ?? [])], [mine, lib]);
  const index = useMemo(() => prepareExercises(all), [all]);
  const filtering = !!(query.trim() || muscle || equip);
  const yours = useMemo(() => new Set([...recent.map((r) => r.ref), ...mine.map((m) => m.ref)]), [recent, mine]);
  const results = filtering ? searchExercises(index, all, { query, muscle: muscle || undefined, equipment: equip || undefined }, 40, yours) : [];
  const byRef = useMemo(() => new Map(all.map((e) => [e.ref, e])), [all]);
  const recents = recent.map((r) => byRef.get(r.ref) ?? { ref: r.ref, name: r.name, equipment: 'other', primary: [], secondary: [] });

  const row = (e: Exercise) => (
    <ListRow key={e.ref} lead={<ExerciseThumb name={e.name} />} main={e.name} sub={[e.primary.map(title).join(', '), e.equipment !== 'none' ? title(e.equipment) : t('exercise.noEquipment')].filter(Boolean).join(' · ')} onClick={() => onPick(e)} />
  );

  return (
    <Sheet
      title={creating ? t('exercise.create') : t('exercise.add')}
      onClose={onClose}
      tall={!creating}
      pinned={
        creating ? undefined : (
          <div class="stack gap-2 mt-2">
            <Field label={t('exercise.search')} labelHidden>
              {(c) => <TextInput {...c} type="search" enterkeyhint="search" autocomplete="off" autofocus placeholder={t('exercise.searchPlaceholder')} value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />}
            </Field>
            <div class="field-row">
              <Field label={t('exercise.muscle')} class="grow">
                {(c) => (
                  <Select {...c} value={muscle} onChange={(e) => setMuscle((e.target as HTMLSelectElement).value)}>
                    <option value="">{t('exercise.any')}</option>
                    {lib?.muscles.map((m) => <option key={m} value={m}>{title(m)}</option>)}
                  </Select>
                )}
              </Field>
              <Field label={t('exercise.equipment')} class="grow">
                {(c) => (
                  <Select {...c} value={equip} onChange={(e) => setEquip((e.target as HTMLSelectElement).value)}>
                    <option value="">{t('exercise.any')}</option>
                    {lib?.equipment.map((m) => <option key={m} value={m}>{title(m)}</option>)}
                  </Select>
                )}
              </Field>
            </div>
          </div>
        )
      }
    >
      {creating ? (
        <CustomExerciseForm initialName={query} muscles={lib?.muscles ?? []} equipment={lib?.equipment ?? ['other']} onBack={() => setCreating(false)} onCreated={onPick} />
      ) : (
        <>
          {!filtering && recents.length > 0 && (
            <section aria-label={t('food.recent')}>
              <SectionTitle>{t('food.recent')}</SectionTitle>
              <List>{recents.map(row)}</List>
            </section>
          )}
          {!filtering && mine.length > 0 && (
            <section aria-label={t('exercise.yours')}>
              <SectionTitle>{t('exercise.yours')}</SectionTitle>
              <List>{mine.map(row)}</List>
            </section>
          )}
          {filtering && (
            <section aria-label={t('exercise.results')}>
              <SectionTitle>{t('exercise.results')}</SectionTitle>
              {results.length ? <List>{results.map(row)}</List> : <p class="muted">{t('exercise.noMatch')}</p>}
            </section>
          )}
          {!filtering && !lib && <p class="muted" role="status">{t('common.loading')}</p>}
          {!filtering && lib && recents.length === 0 && mine.length === 0 && <p class="muted mt-3">{t('exercise.hint')}</p>}
          <Button block class="mt-4" onClick={() => setCreating(true)}>
            <Icon name="plus" size="sm" />{query.trim() ? `${t('exercise.create')} “${query.trim()}”` : t('exercise.create')}
          </Button>
          {lib && <p class="t-caption mt-3">{t('exercise.credit')}</p>}
        </>
      )}
    </Sheet>
  );
}

export { HowTo, newId };
