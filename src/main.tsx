import { render } from 'preact';
import './styles/tokens.css';
import './styles/base.css';
import { App } from './app';
import { initState } from './state';
import { registerServiceWorker } from './pwa/register';

await initState();
render(<App />, document.getElementById('app')!);
registerServiceWorker();
