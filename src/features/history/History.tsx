import { Screen } from '../../components/Screen';
import { t } from '../../i18n';

export function History() {
  return (
    <Screen title={t('nav.history')}>
      <div class="card"><p class="muted">{t('history.empty')}</p></div>
    </Screen>
  );
}
