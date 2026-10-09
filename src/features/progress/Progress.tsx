import { Card, Screen } from '../../ui';
import { t } from '../../i18n';

export function Progress() {
  return (
    <Screen title={t('nav.progress')}>
      <Card><p class="muted">{t('progress.empty')}</p></Card>
    </Screen>
  );
}
