import { ROUTES, route } from '../router';
import { t, type Key } from '../i18n';
import { Icon } from './Icon';

export function TabBar() {
  return (
    <nav class="tabbar" aria-label={t('a11y.nav')}>
      {ROUTES.map((r) => (
        <a key={r} href={`#/${r}`} aria-current={route.value === r ? 'page' : undefined}>
          <span class="tab-pill"><Icon name={r} /></span>
          <span>{t(`nav.${r}` as Key)}</span>
        </a>
      ))}
    </nav>
  );
}
