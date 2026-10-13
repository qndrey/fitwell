import { useEffect, useState } from 'preact/hooks';
import { firstDataAt } from '../../db/foodStore';
import { onChange } from '../../db/broadcast';
import { Button, Card, Icon } from '../../ui';
import { t } from '../../i18n';

const KEY = 'fitwell-welcome-hidden';
const hiddenBefore = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

/** First run only: three ways in, then it gets out of the way (as soon as anything is logged, or when hidden). */
export function Welcome({ onFood, onWorkout }: { onFood: () => void; onWorkout: () => void }) {
  const [state, setState] = useState<'unknown' | 'new' | 'returning'>('unknown');
  const [hidden, setHidden] = useState(hiddenBefore);
  useEffect(() => {
    const load = () => void firstDataAt().then((at) => setState(at === undefined ? 'new' : 'returning'));
    load();
    return onChange((c) => c.store === 'foodEntries' && load());
  }, []);
  if (hidden || state !== 'new') return null;
  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* storage may be blocked; hiding for this visit is enough */
    }
  };
  return (
    <Card labelledBy="welcome-h" class="welcome">
      <div class="stack gap-3">
        <div class="stack gap-1">
          <h2 id="welcome-h" class="card-title">{t('welcome.title')}</h2>
          <p class="muted">{t('welcome.body')}</p>
        </div>
        <div class="welcome-actions">
          <Button onClick={onFood}><Icon name="food" size="sm" />{t('welcome.food')}</Button>
          <Button onClick={onWorkout}><Icon name="strength" size="sm" />{t('welcome.workout')}</Button>
          <Button onClick={() => (location.hash = '#/settings')}><Icon name="settings" size="sm" />{t('welcome.goals')}</Button>
        </div>
        <Button variant="ghost" size="sm" class="align-start" onClick={hide}>{t('welcome.hide')}</Button>
      </div>
    </Card>
  );
}
