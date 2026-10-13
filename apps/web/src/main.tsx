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
watchUnresolved();
void ensureMeasurementTypes().then(watchBody).catch(() => undefined);
startQueue();
registerServiceWorker();
