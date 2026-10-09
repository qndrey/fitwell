import { Card, Screen } from '../../ui';
import { t } from '../../i18n';

export function History() {
  return (
    <Screen title={t('nav.history')}>
      <Card><p class="muted">{t('history.empty')}</p></Card>
    </Screen>
  );
}
