import { Screen } from '../../components/Screen';
import { formatDay, today } from '../../domain/dates';
import { t } from '../../i18n';

export function Today() {
  return (
    <Screen title={t('nav.today')} subtitle={formatDay(today())}>
      <div class="card"><p class="muted">{t('today.empty')}</p></div>
    </Screen>
  );
}
