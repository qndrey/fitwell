import { Screen } from '../../components/Screen';
import { t } from '../../i18n';

export function Progress() {
  return (
    <Screen title={t('nav.progress')}>
      <div class="card"><p class="muted">{t('progress.empty')}</p></div>
    </Screen>
  );
}
