import { useEffect, useMemo, useState } from 'preact/hooks';
import { Button, Field, Icon, List, ListRow, Notice, SectionTitle, Sheet, TextInput } from '../../ui';
import { cacheOnlineFood, cachedFoodItems, customFoodItems, favoritesRepo, recentFoods, savedMealsRepo, setFavorite, favoriteId, type RecentFood } from '../../db/foodStore';
import type { SavedMeal, Slot } from '@fitwell/core/schema';
import { refKey, type FoodItem } from '@fitwell/core/domain/foods';
import { roundForDisplay, scale, sum, quantityGrams, type Quantity } from '@fitwell/core/domain/nutrition';
import { loadBundledFoods } from '@fitwell/core/data/bundledFoods';
import { prepare, search } from '@fitwell/core/search/rank';
import { online, settings } from '../../state';
import { offLookup } from '../../off';
import { OffError } from '@fitwell/core/off/client';
import { t, type Key } from '../../i18n';
import { logFood, logMeal, deleteMeal, logPending } from './actions';
import { PendingForm } from './PendingForm';
import { ScanSheet } from './ScanSheet';
import { candidateToFood } from './online';
import { CustomFoodForm } from './CustomFoodForm';
import { QuantityForm, defaultQuantity } from './QuantityForm';
import { SlotPicker } from './SlotPicker';
import { fmt, quantityText } from './format';

type Step =
  | { kind: 'search' }
  | { kind: 'quantity'; food: FoodItem; initial: Quantity }
  | { kind: 'custom' }
  | { kind: 'pending'; text: string }
  | { kind: 'meal'; meal: SavedMeal };

type Online = { status: 'idle' } | { status: 'loading' } | { status: 'done'; foods: FoodItem[] } | { status: 'error'; message: string };

export interface PickMode {
  title: string;
  onPick: (food: FoodItem) => void;
}


interface Lists {
  favorites: FoodItem[];
  recents: RecentFood[];
  custom: FoodItem[];
  cached: FoodItem[];
  meals: SavedMeal[];
  bundled: FoodItem[];
}

const EMPTY: Lists = { favorites: [], recents: [], custom: [], cached: [], meals: [], bundled: [] };

export function AddFoodSheet({ day, initialSlot, onClose, pickMode, initialQuery = '' }: { day: string; initialSlot: Slot; onClose: () => void; pickMode?: PickMode; initialQuery?: string }) {
  const [slot, setSlot] = useState<Slot>(initialSlot);
  const [step, setStep] = useState<Step>({ kind: 'search' });
  const [query, setQuery] = useState(initialQuery);
  const [scanning, setScanning] = useState(false);
  const [onlineResult, setOnlineResult] = useState<Online>({ status: 'idle' });
  const [lists, setLists] = useState<Lists>(EMPTY);
  const [added, setAdded] = useState('');

  async function reload() {
    const [favs, recents, custom, cached, meals] = await Promise.all([favoritesRepo.list(), recentFoods(), customFoodItems(), cachedFoodItems(), savedMealsRepo.list()]);
    setLists((l) => ({ ...l, favorites: favs.map((f) => f.food), recents, custom, cached, meals: meals.sort((a, b) => a.name.localeCompare(b.name)) }));
  }
  useEffect(() => {
    void reload();
    void loadBundledFoods().then((d) => setLists((l) => ({ ...l, bundled: d.foods })));
  }, []);

  const favIndex = useMemo(() => prepare(dedupe([...lists.favorites, ...lists.recents.map((r) => r.food)]), (f) => f.name), [lists.favorites, lists.recents]);
  const customIndex = useMemo(() => prepare(lists.custom, (f) => f.name), [lists.custom]);
  const cachedIndex = useMemo(() => prepare(lists.cached, (f) => f.name), [lists.cached]);
  const mealIndex = useMemo(() => prepare(lists.meals, (m) => m.name), [lists.meals]);
  const bundledIndex = useMemo(() => prepare(lists.bundled, (f) => f.name), [lists.bundled]);

  const quantityFor = (food: FoodItem): Quantity => lists.recents.find((r) => refKey(r.food.ref) === refKey(food.ref))?.quantity ?? defaultQuantity(food);
  const pick = (food: FoodItem) => (pickMode ? pickMode.onPick(food) : setStep({ kind: 'quantity', food, initial: quantityFor(food) }));

  async function searchOnline(term: string) {
    setOnlineResult({ status: 'loading' });
    try {
      const found = await offLookup.search(term, 'interactive');
      setOnlineResult({ status: 'done', foods: found.map(candidateToFood) });
    } catch (e) {
      const kind = e instanceof OffError ? e.kind : 'server';
      setOnlineResult({ status: 'error', message: kind === 'offline' ? t('online.offline') : kind === 'rate' ? t('online.busy') : t('online.failed') });
    }
  }

  const q = query.trim();
  const shown = new Set<string>();
  const take = (list: FoodItem[]) => list.filter((f) => !shown.has(refKey(f.ref)) && !!shown.add(refKey(f.ref)));
  const sections: { title: string; foods?: FoodItem[]; meals?: SavedMeal[] }[] = q
    ? [
        { title: t('food.favoritesRecent'), foods: take(search(favIndex, q, 10)) },
        { title: t('food.savedMeals'), meals: pickMode ? [] : search(mealIndex, q, 5) },
        { title: t('food.yourFoods'), foods: take(search(customIndex, q, 10)) },
        { title: t('food.cached'), foods: take(search(cachedIndex, q, 10)) },
        { title: t('food.database'), foods: take(search(bundledIndex, q, 30)) },
      ]
    : [
        { title: t('food.favorites'), foods: take(lists.favorites.slice(0, 10)) },
        { title: t('food.recent'), foods: take(lists.recents.slice(0, 12).map((r) => r.food)) },
        { title: t('food.savedMeals'), meals: pickMode ? [] : lists.meals },
        { title: t('food.yourFoods'), foods: take(lists.custom.slice(0, 8)) },
      ];
  const visible = sections.filter((s) => (s.foods?.length ?? 0) + (s.meals?.length ?? 0) > 0);

  const title = step.kind === 'search' ? (pickMode?.title ?? t('food.add')) : step.kind === 'pending' ? t('pending.title') : step.kind === 'custom' ? t('custom.title') : step.kind === 'meal' ? step.meal.name : step.food.name;
  const back = () => setStep({ kind: 'search' });

  return (
    <Sheet
      title={title}
      onClose={onClose}
      tall={step.kind === 'search'}
      pinned={
        step.kind === 'custom' ? undefined : (
          <>
            {!pickMode && <SlotPicker value={slot} onChange={setSlot} name="add-slot" />}
            {step.kind === 'search' && (
              <div class="cluster gap-2 mt-3 nowrap">
                <Field label={t('food.search')} labelHidden class="grow">
                  {(c) => (
                    <TextInput
                      {...c}
                      type="search"
                      enterkeyhint="search"
                      autocomplete="off"
                      autofocus
                      value={query}
                      placeholder={t('food.searchPlaceholder')}
                      onInput={(e) => {
                        setQuery((e.target as HTMLInputElement).value);
                        setOnlineResult({ status: 'idle' });
                      }}
                    />
                  )}
                </Field>
                {settings.value.onlineLookup && (
                  <Button icon aria-label={t('scan.open')} onClick={() => setScanning(true)}>
                    <Icon name="scan" size="lg" />
                  </Button>
                )}
              </div>
            )}
          </>
        )
      }
    >
      <p class="sr-only" role="status" aria-live="polite">{added}</p>
      {scanning && (
        <ScanSheet
          onClose={() => setScanning(false)}
          onFood={(food) => {
            setScanning(false);
            pick(food);
          }}
          onCustom={() => {
            setScanning(false);
            setStep({ kind: 'custom' });
          }}
          onLater={
            pickMode
              ? undefined
              : async (code) => {
                  setScanning(false);
                  await logPending(day, slot, code, 100);
                  setAdded(t('scan.kept'));
                }
          }
        />
      )}

      {step.kind === 'search' && (
        <>
          {added && <p class="added mt-3 cluster gap-2" aria-hidden="true"><Icon name="check" size="sm" />{added}</p>}
          {visible.map((s) => (
            <section key={s.title} aria-label={s.title}>
              <SectionTitle>{s.title}</SectionTitle>
              <List>
                {s.foods?.map((f) => (
                  <ListRow
                    key={refKey(f.ref)}
                    main={f.name}
                    sub={[f.brand, f.group, settings.value.habitOnly ? '' : `${Math.round(f.per100g.kcal)} ${t('unit.kcal')}/100 g`].filter(Boolean).join(' · ')}
                    onClick={() => pick(f)}
                  />
                ))}
                {s.meals?.map((m) => (
                  <ListRow key={m.id} main={m.name} sub={`${m.items.length} ${t('food.items')}`} onClick={() => setStep({ kind: 'meal', meal: m })} />
                ))}
              </List>
            </section>
          ))}
          {q && visible.length === 0 && <p class="muted mt-3">{t('food.noMatch')}</p>}

          {q.length >= 2 && settings.value.onlineLookup && (
            <section aria-label={t('online.title')} class="mt-3">
              {onlineResult.status === 'idle' && (
                <>
                  <Button block disabled={!online.value} onClick={() => void searchOnline(q)}>
                    <Icon name="search" size="sm" />{t('online.search')}
                  </Button>
                  {!online.value && <p class="t-caption mt-2">{t('online.offline')}</p>}
                </>
              )}
              {onlineResult.status === 'loading' && <p class="muted" role="status">{t('online.searching')}</p>}
              {onlineResult.status === 'error' && <Notice quiet role="status">{onlineResult.message}</Notice>}
              {onlineResult.status === 'done' && (
                <>
                  <SectionTitle>{t('online.title')}</SectionTitle>
                  {onlineResult.foods.length === 0 ? (
                    <p class="muted">{t('online.none')}</p>
                  ) : (
                    <List>
                      {onlineResult.foods.map((f) => (
                        <ListRow
                          key={f.ref.id}
                          main={f.name}
                          sub={[f.brand, settings.value.habitOnly ? '' : `${Math.round(f.per100g.kcal)} ${t('unit.kcal')}/100 g`].filter(Boolean).join(' · ')}
                          onClick={() => pick(f)}
                        />
                      ))}
                    </List>
                  )}
                  <p class="t-caption mt-2">{t('online.attribution')}</p>
                </>
              )}
            </section>
          )}

          <Button block class="mt-4" onClick={() => setStep({ kind: 'custom' })}>
            {q ? `${t('custom.create')} “${q}”` : t('custom.create')}
          </Button>
          {q && !pickMode && (
            <Button block class="mt-3" onClick={() => setStep({ kind: 'pending', text: q })}>
              {`${t('pending.log')} “${q}”`}
            </Button>
          )}
          <div class="sticky-action">
            <Button variant="primary" block onClick={onClose}>{pickMode ? t('common.cancel') : t('common.done')}</Button>
          </div>
        </>
      )}

      {step.kind === 'quantity' && (
        <FoodQuantity
          food={step.food}
          initial={step.initial}
          slot={slot}
          onBack={back}
          onLogged={async (q2) => {
            if (step.food.ref.kind === 'off') await cacheOnlineFood(step.food);
            await logFood(day, slot, step.food, q2);
            setAdded(`${t('food.added')}: ${step.food.name}`);
            setQuery('');
            void reload();
            back();
          }}
        />
      )}

      {step.kind === 'pending' && (
        <PendingForm
          initialText={step.text}
          submitLabel={`${t('food.addTo')} ${t(`slot.${slot}` as Key)}`}
          onSubmit={async (text, grams) => {
            await logPending(day, slot, text, grams);
            setAdded(`${t('pending.added')}: ${text}`);
            setQuery('');
            back();
          }}
        />
      )}

      {step.kind === 'custom' && (
        <CustomFoodForm
          initialName={q}
          onCancel={back}
          onCreated={(food) => {
            void reload();
            if (pickMode) return pickMode.onPick(food);
            setStep({ kind: 'quantity', food, initial: defaultQuantity(food) });
          }}
        />
      )}

      {step.kind === 'meal' && (
        <MealStep
          meal={step.meal}
          slot={slot}
          onBack={back}
          onAdd={async () => {
            await logMeal(day, slot, step.meal);
            setAdded(`${t('food.added')}: ${step.meal.name}`);
            back();
          }}
          onDelete={async () => {
            await deleteMeal(step.meal);
            void reload();
            back();
          }}
        />
      )}
    </Sheet>
  );
}

function dedupe(list: FoodItem[]): FoodItem[] {
  const seen = new Set<string>();
  return list.filter((f) => !seen.has(refKey(f.ref)) && !!seen.add(refKey(f.ref)));
}

function FoodQuantity({ food, initial, slot, onBack, onLogged }: { food: FoodItem; initial: Quantity; slot: Slot; onBack: () => void; onLogged: (q: Quantity) => void }) {
  const [fav, setFav] = useState<boolean | null>(null);
  useEffect(() => {
    void favoritesRepo.get(favoriteId(food)).then((f) => setFav(!!f));
  }, [food]);
  return (
    <>
      <p class="muted mb-3">{[food.brand, food.group].filter(Boolean).join(' · ')}</p>
      <QuantityForm food={food} initial={initial} submitLabel={`${t('food.addTo')} ${t(`slot.${slot}` as Key)}`} onSubmit={onLogged} />
      <div class="cluster between mt-4">
        <Button onClick={onBack}>{t('common.back')}</Button>
        {fav !== null && (
          <Button
            aria-pressed={fav}
            onClick={async () => {
              await setFavorite(food, !fav);
              setFav(!fav);
            }}
          >
            <Icon name="star" size="sm" filled={!!fav} />{t('food.favorite')}
          </Button>
        )}
      </div>
    </>
  );
}

function MealStep({ meal, slot, onBack, onAdd, onDelete }: { meal: SavedMeal; slot: Slot; onBack: () => void; onAdd: () => void; onDelete: () => void }) {
  const total = roundForDisplay(sum(meal.items.map((i) => scale(i.food.per100g, quantityGrams(i.quantity, i.food.portions)))));
  return (
    <>
      <List>
        {meal.items.map((i, n) => (
          <ListRow key={n} main={i.food.name} sub={quantityText(i.quantity)} />
        ))}
      </List>
      {!settings.value.habitOnly && (
        <p class="t-caption mt-3">
          {total.kcal} {t('unit.kcal')} · {t('macro.protein.short')} {fmt(total.protein)} g · {t('macro.carbs.short')} {fmt(total.carbs)} g · {t('macro.fat.short')} {fmt(total.fat)} g
        </p>
      )}
      <Button variant="primary" block class="mt-4" onClick={onAdd}>{`${t('meal.addAll')} ${t(`slot.${slot}` as Key)}`}</Button>
      <div class="cluster between mt-4">
        <Button onClick={onBack}>{t('common.back')}</Button>
        <Button onClick={onDelete}>{t('meal.delete')}</Button>
      </div>
    </>
  );
}
