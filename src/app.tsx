import { route } from './router';
import { storageAvailable } from './state';
import { TabBar } from './components/TabBar';
import { UpdateToast } from './components/UpdateToast';
import { Today } from './features/today/Today';
import { History } from './features/history/History';
import { Progress } from './features/progress/Progress';
import { Settings } from './features/settings/Settings';
import { t } from './i18n';

const SCREENS = { today: Today, history: History, progress: Progress, settings: Settings };

export function App() {
  const Current = SCREENS[route.value];
  return (
    <>
      <a
        class="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        {t('a11y.skip')}
      </a>
      <div class="shell">
        <TabBar />
        <main id="main" tabIndex={-1}>
          {!storageAvailable.value && <div class="notice" role="status">{t('storage.unavailable')}</div>}
          <Current />
        </main>
      </div>
      <UpdateToast />
    </>
  );
}
