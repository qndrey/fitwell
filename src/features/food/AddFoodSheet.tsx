import { useEffect, useMemo, useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet';
import { customFoodItems, favoritesRepo, recentFoods, savedMealsRepo, setFavorite, favoriteId, type RecentFood } from '../../db/foodStore';
import type { SavedMeal, Slot } from '../../db/schema';
import { refKey, type FoodItem } from '../../domain/foods';
import { roundForDisplay, scale, sum, quantityGrams, type Quantity } from '../../domain/nutrition';
import { loadBundledFoods } from '../../data/bundledFoods';
import { prepare, search } from '../../search/rank';
import { settings } from '../../state';
import { t, type Key } from '../../i18n';
import { logFood, logMeal, deleteMeal } from './actions';
import { CustomFoodForm } from './CustomFoodForm';
import { QuantityForm, defaultQuantity } from './QuantityForm';
import { SlotPicker } from './SlotPicker';
import { fmt, quantityText } from './format';

type Step =
  | { kind: 'search' }
  | { kind: 'quantity'; food: FoodItem; initial: Quantity }
  | { kind: 'custom' }
  | { kind: 'meal'; meal: SavedMeal };

interface Lists {
  favorites: FoodItem[];
  recents: RecentFood[];
  custom: FoodItem[];
  meals: SavedMeal[];
  bundled: FoodItem[];
}

const EMPTY: Lists = { favorites: [], recents: [], custom: [], meals: [], bundled: [] };

export function AddFoodSheet({ day, initialSlot, onClose }: { day: string; initialSlot: Slot; onClose: () => void }) {
  const [slot, setSlot] = useState<Slot>(initialSlot);
  const [step, setStep] = useState<Step>({ kind: 'search' });
  const [query, setQuery] = useState('');
  const [lists, setLists] = useState<Lists>(EMPTY);
  const [added, setAdded] = useState('');

  async function reload() {
    const [favs, recents, custom, meals] = await Promise.all([favoritesRepo.list(), recentFoods(), customFoodItems(), savedMealsRepo.list()]);
    setLists((l) => ({ ...l, favorites: favs.map((f) => f.food), recents, custom, meals: meals.sort((a, b) => a.name.localeCompare(b.name)) }));
  }
  useEffect(() => {
    void reload();
    void loadBundledFoods().then((d) => setLists((l) => ({ ...l, bundled: d.foods })));
  }, []);

  const favIndex = useMemo(() => prepare(dedupe([...lists.favorites, ...lists.recents.map((r) => r.food)]), (f) => f.name), [lists.favorites, lists.recents]);
  const customIndex = useMemo(() => prepare(lists.custom, (f) => f.name), [lists.custom]);
  const mealIndex = useMemo(() => prepare(lists.meals, (m) => m.name), [lists.meals]);
  const bundledIndex = useMemo(() => prepare(lists.bundled, (f) => f.name), [lists.bundled]);

  const quantityFor = (food: FoodItem): Quantity => lists.recents.find((r) => refKey(r.food.ref) === refKey(food.ref))?.quantity ?? defaultQuantity(food);
  const pick = (food: FoodItem) => setStep({ kind: 'quantity', food, initial: quantityFor(food) });

  const q = query.trim();
  const shown = new Set<string>();
  const take = (list: FoodItem[]) => list.filter((f) => !shown.has(refKey(f.ref)) && !!shown.add(refKey(f.ref)));
  const sections: { title: string; foods?: FoodItem[]; meals?: SavedMeal[] }[] = q
    ? [
        { title: t('food.favoritesRecent'), foods: take(search(favIndex, q, 10)) },
        { title: t('food.savedMeals'), meals: search(mealIndex, q, 5) },
        { title: t('food.yourFoods'), foods: take(search(customIndex, q, 10)) },
        { title: t('food.database'), foods: take(search(bundledIndex, q, 30)) },
      ]
    : [
        { title: t('food.favorites'), foods: take(lists.favorites.slice(0, 10)) },
        { title: t('food.recent'), foods: take(lists.recents.slice(0, 12).map((r) => r.food)) },
        { title: t('food.savedMeals'), meals: lists.meals },
        { title: t('food.yourFoods'), foods: take(lists.custom.slice(0, 8)) },
      ];
  const visible = sections.filter((s) => (s.foods?.length ?? 0) + (s.meals?.length ?? 0) > 0);

  const title = step.kind === 'search' ? t('food.add') : step.kind === 'custom' ? t('custom.title') : step.kind === 'meal' ? step.meal.name : step.food.name;
  const back = () => setStep({ kind: 'search' });

  return (
    <Sheet title={title} onClose={onClose}>
      {step.kind !== 'custom' && <SlotPicker value={slot} onChange={setSlot} name="add-slot" />}
      <p class="sr-only" role="status" aria-live="polite">{added}</p>

      {step.kind === 'search' && (
        <>
          {added && <p class="added" aria-hidden="true">✓ {added}</p>}
          <div class="field">
            <label for="food-search">{t('food.search')}</label>
            <input
              id="food-search"
              type="search"
              autocomplete="off"
              autofocus
              value={query}
              placeholder={t('food.searchPlaceholder')}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            />
          </div>
          {visible.map((s) => (
            <section key={s.title} aria-label={s.title}>
              <h3 class="list-title">{s.title}</h3>
              <ul class="list">
                {s.foods?.map((f) => (
                  <li key={refKey(f.ref)}>
                    <button type="button" class="row" onClick={() => pick(f)}>
                      <span class="row-main">{f.name}</span>
                      <span class="row-sub">{[f.brand, f.group, settings.value.habitOnly ? '' : `${Math.round(f.per100g.kcal)} ${t('unit.kcal')}/100 g`].filter(Boolean).join(' · ')}</span>
                    </button>
                  </li>
                ))}
                {s.meals?.map((m) => (
                  <li key={m.id}>
                    <button type="button" class="row" onClick={() => setStep({ kind: 'meal', meal: m })}>
                      <span class="row-main">{m.name}</span>
                      <span class="row-sub">{`${m.items.length} ${t('food.items')}`}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {q && visible.length === 0 && <p class="muted">{t('food.noMatch')}</p>}
          <button type="button" class="btn wide" onClick={() => setStep({ kind: 'custom' })}>
            {q ? `${t('custom.create')} “${q}”` : t('custom.create')}
          </button>
          <div class="actions">
            <button type="button" class="btn primary" onClick={onClose}>{t('common.done')}</button>
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
            await logFood(day, slot, step.food, q2);
            setAdded(`${t('food.added')}: ${step.food.name}`);
            setQuery('');
            void reload();
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
      <p class="muted">{[food.brand, food.group].filter(Boolean).join(' · ')}</p>
      <QuantityForm food={food} initial={initial} submitLabel={`${t('food.addTo')} ${t(`slot.${slot}` as Key)}`} onSubmit={onLogged} />
      <div class="actions">
        <button type="button" class="btn" onClick={onBack}>{t('common.back')}</button>
        {fav !== null && (
          <button
            type="button"
            class="btn"
            aria-pressed={fav}
            onClick={async () => {
              await setFavorite(food, !fav);
              setFav(!fav);
            }}
          >
            <span aria-hidden="true">{fav ? '★ ' : '☆ '}</span>{t('food.favorite')}
          </button>
        )}
      </div>
    </>
  );
}

function MealStep({ meal, slot, onBack, onAdd, onDelete }: { meal: SavedMeal; slot: Slot; onBack: () => void; onAdd: () => void; onDelete: () => void }) {
  const total = roundForDisplay(sum(meal.items.map((i) => scale(i.food.per100g, quantityGrams(i.quantity, i.food.portions)))));
  return (
    <>
      <ul class="list">
        {meal.items.map((i, n) => (
          <li key={n} class="row static">
            <span class="row-main">{i.food.name}</span>
            <span class="row-sub">{quantityText(i.quantity)}</span>
          </li>
        ))}
      </ul>
      {!settings.value.habitOnly && <p class="preview">{total.kcal} {t('unit.kcal')} · {t('macro.protein.short')} {fmt(total.protein)} g · {t('macro.carbs.short')} {fmt(total.carbs)} g · {t('macro.fat.short')} {fmt(total.fat)} g</p>}
      <button type="button" class="btn primary wide" onClick={onAdd}>{`${t('meal.addAll')} ${t(`slot.${slot}` as Key)}`}</button>
      <div class="actions">
        <button type="button" class="btn" onClick={onBack}>{t('common.back')}</button>
        <button type="button" class="btn" onClick={onDelete}>{t('meal.delete')}</button>
      </div>
    </>
  );
}
