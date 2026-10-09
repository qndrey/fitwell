import { ROUTES, route } from '../router';
import { t, type Key } from '../i18n';

export function TabBar() {
  return (
    <nav class="tabbar" aria-label={t('a11y.nav')}>
      {ROUTES.map((r) => (
        <a key={r} href={`#/${r}`} aria-current={route.value === r ? 'page' : undefined}>
          {t(`nav.${r}` as Key)}
        </a>
      ))}
    </nav>
  );
}
