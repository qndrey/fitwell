import { useEffect, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { route } from './router';
import { storageAvailable } from './state';
import { Notice, TabBar } from './ui';
import { Toaster } from './ui';
import { Today } from './features/today/Today';
import { History } from './features/history/History';
import { Settings } from './features/settings/Settings';
import { Review } from './features/review/Review';
import { StrengthPage } from './features/workout/StrengthPage';
import { t } from './i18n';

/** The About screen carries every licence text, so it loads only when opened. */
function LazyAbout() {
  const [C, setC] = useState<ComponentType | null>(null);
  useEffect(() => void import('./features/about/About').then((m) => setC(() => m.About)), []);
  return C ? <C /> : null;
}

/** Charts load only when Progress is opened. */
function LazyProgress() {
  const [C, setC] = useState<ComponentType | null>(null);
  useEffect(() => void import('./features/progress/Progress').then((m) => setC(() => m.Progress)), []);
  return C ? <C /> : null;
}

/** The AI screen (prompts and import) loads only when opened. */
function LazyAi() {
  const [C, setC] = useState<ComponentType | null>(null);
  useEffect(() => void import('./features/ai/AiPage').then((m) => setC(() => m.AiPage)), []);
  return C ? <C /> : null;
}

const SCREENS = { today: Today, history: History, progress: LazyProgress, settings: Settings };

/** The style guide is its own chunk: it is not in the tab bar and is never needed for everyday use. */
function LazyDesign() {
  const [C, setC] = useState<ComponentType | null>(null);
  useEffect(() => void import('./features/design/Design').then((m) => setC(() => m.Design)), []);
  return C ? <C /> : null;
}

export function App() {
  const Current = route.value === 'design' ? LazyDesign : route.value === 'review' ? Review : route.value === 'workout' ? StrengthPage : route.value === 'about' ? LazyAbout : route.value === 'ai' ? LazyAi : SCREENS[route.value];
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
          {!storageAvailable.value && <Notice role="status">{t('storage.unavailable')}</Notice>}
          <Current />
        </main>
      </div>
      <Toaster />
    </>
  );
}
