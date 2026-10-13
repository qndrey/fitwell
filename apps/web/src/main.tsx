import { render } from 'preact';
import '@fontsource-variable/figtree/wght.css';
import './styles/scale.css';
import './styles/tokens.css';
import './styles/reset.css';
import './styles/typography.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/utilities.css';
import { App } from './app';
import { initState } from './state';
import { registerServiceWorker } from './pwa/register';
import { startQueue } from './queue';
import { DELETED_FLAG } from './db/deleteAll';
import { showToast } from './features/food/toast';
import { t } from './i18n';
import { watchBody } from './features/body/store';
import { ensureMeasurementTypes } from './db/bodyStore';
import { watchUnresolved } from './features/review/store';
import { watchActiveWorkout } from './features/workout/active';

await initState();
try {
  if (sessionStorage.getItem(DELETED_FLAG)) {
    sessionStorage.removeItem(DELETED_FLAG);
    showToast(t('delete.done'), undefined, 8000);
  }
} catch {
  /* storage may be blocked */
}
render(<App />, document.getElementById('app')!);
hideSplash();
watchUnresolved();
watchActiveWorkout();
void ensureMeasurementTypes().then(watchBody).catch(() => undefined);
startQueue();
registerServiceWorker();

/** Fades out the start-up screen from index.html once the first screen is drawn. */
function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash) return;
  splash.classList.add('done');
  setTimeout(() => splash.remove(), 300);
}
