import { useState } from 'preact/hooks';
import { formatDay } from '../../domain/dates';
import { roundForDisplay, scale } from '../../domain/nutrition';
import type { FoodEntry } from '../../db/schema';
import { online, settings } from '../../state';
import { Badge, Button, Card, Choice, EmptyState, Icon, LinkButton, List, ListRow, Screen, SectionTitle, Sheet } from '../../ui';
import { t, type Key } from '../../i18n';
import { AddFoodSheet } from '../food/AddFoodSheet';
import { deleteEntry, resolveWithFood, resolveWithValues, retryLookup } from '../food/actions';
import { entryLabel, fmt, quantityText } from '../food/format';
import { candidateToFood } from '../food/online';
import { ValuesForm } from '../food/ValuesForm';
import { pendingStatus } from '../food/PendingEntrySheet';
import { showToast } from '../food/toast';
import { unresolved } from './store';

function ReviewItem({ entry }: { entry: FoodEntry }) {
  const cands = entry.lookup?.candidates ?? [];
  const [sel, setSel] = useState(entry.lookup?.suggestedIndex ?? 0);
  const [panel, setPanel] = useState<null | 'search' | 'values'>(null);
  const grams = entry.quantity.amount;
  const habitOnly = settings.value.habitOnly;

  return (
    <Card labelledBy={`rv-${entry.id}`}>
      <div class="stack gap-3">
        <div>
          <h2 id={`rv-${entry.id}`}>{entryLabel(entry)}</h2>
          <p class="t-caption">
            {formatDay(entry.day, { weekday: 'short', month: 'short', day: 'numeric' })} · {t(`slot.${entry.slot}` as Key)} · {quantityText(entry.quantity)}
          </p>
        </div>

        {cands.length > 0 ? (
          <fieldset>
            <legend class="t-overline section-title">{t('review.candidates')}</legend>
            {cands.map((c, i) => {
              const n = roundForDisplay(scale(c.per100g, grams));
              return (
                <Choice
                  key={c.sourceId}
                  type="radio"
                  name={`cand-${entry.id}`}
                  checked={sel === i}
                  onChange={() => setSel(i)}
                  label={[c.name, c.brand].filter(Boolean).join(' · ')}
                  help={habitOnly ? undefined : `${Math.round(c.per100g.kcal)} ${t('unit.kcal')} ${t('review.perHundred')} · ${t('review.forAmount')} ${fmt(grams)} g: ${n.kcal} ${t('unit.kcal')}`}
                />
              );
            })}
          </fieldset>
        ) : (
          <p class="muted">{t('review.none')}</p>
        )}

        <div class="stack gap-2">
          {cands.length > 0 && (
            <Button
              variant="primary"
              block
              onClick={async () => {
                await resolveWithFood(entry, candidateToFood(cands[sel]!));
                showToast(t('review.resolved'));
              }}
            >
              <Icon name="check" size="sm" />{t('review.useMatch')}
            </Button>
          )}
          <Button block onClick={() => setPanel('search')}><Icon name="search" size="sm" />{t('review.search')}</Button>
          <Button block onClick={() => setPanel('values')}>{t('review.values')}</Button>
          <div class="cluster between">
            {entry.state === 'unmatched' ? (
              <LinkButton disabled={!online.value} onClick={() => void retryLookup(entry)}>{t('review.tryAgain')}</LinkButton>
            ) : (
              <span />
            )}
            <LinkButton onClick={() => void deleteEntry(entry)}>{t('food.remove')}</LinkButton>
          </div>
        </div>
      </div>

      {panel === 'search' && (
        <AddFoodSheet
          day={entry.day}
          initialSlot={entry.slot}
          initialQuery={entry.queryText ?? ''}
          pickMode={{
            title: t('review.search'),
            onPick: async (food) => {
              await resolveWithFood(entry, food);
              setPanel(null);
              showToast(t('review.resolved'));
            },
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'values' && (
        <Sheet title={t('values.title')} onClose={() => setPanel(null)}>
          <p class="mb-3">{t('values.help')} {entry.queryText}, {quantityText(entry.quantity)}.</p>
          <ValuesForm
            submitLabel={t('values.save')}
            onSubmit={async (n) => {
              await resolveWithValues(entry, n);
              setPanel(null);
              showToast(t('review.resolved'));
            }}
          />
        </Sheet>
      )}
    </Card>
  );
}

export function Review() {
  const list = unresolved.value;
  const needs = list.filter((e) => e.state !== 'pending');
  const waiting = list.filter((e) => e.state === 'pending');
  return (
    <Screen title={t('review.title')} subtitle={t('review.intro')} back={{ label: t('review.back'), onBack: () => (location.hash = '#/today') }}>
      {needs.length === 0 && waiting.length === 0 && <EmptyState>{t('review.empty')}</EmptyState>}
      {needs.map((e) => (
        <ReviewItem key={e.id} entry={e} />
      ))}
      {waiting.length > 0 && (
        <section aria-label={t('review.waiting')}>
          <SectionTitle>{t('review.waiting')}</SectionTitle>
          <List>
            {waiting.map((e) => (
              <ListRow key={e.id} main={entryLabel(e)} sub={<>{quantityText(e.quantity)} · <Badge tone="attention">{pendingStatus(e) || t('pending.badge')}</Badge></>} />
            ))}
          </List>
        </section>
      )}
    </Screen>
  );
}
