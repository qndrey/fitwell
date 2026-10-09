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

await initState();
render(<App />, document.getElementById('app')!);
registerServiceWorker();
