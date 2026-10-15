import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { ExerciseGuide } from '../../src/exercises/guide';
import { h } from '../shared/dom';
import { renderGuide } from '../shared/guide';
import { createMotionPlayer } from '../shared/motionView';

const root = document.getElementById('app')!;
const app = new App({ name: 'Fitwell exercise guide', version: '0.1.0' }, {}, { autoResize: true });
let guide: ExerciseGuide | null = null;
/** One WebGL player for the life of the view; null when the device cannot do WebGL (the guide then has no animation). */
const motion = createMotionPlayer();
let shown: ExerciseGuide | null = null;

/** Asks the host to open the address; false when the host cannot or the person declines. */
async function openLink(url: string): Promise<boolean> {
  try {
    const res = await app.openLink({ url });
    return !res.isError;
  } catch {
    return false;
  }
}

function render() {
  try {
    if (guide && guide !== shown) {
      motion?.show(guide.motion, guide.name);
      shown = guide;
    }
    root.replaceChildren(guide ? h('section', { className: 'card single' }, renderGuide(guide, openLink, motion?.element)) : h('p', { className: 'muted center' }, 'Loading the guide…'));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    root.replaceChildren(h('p', { className: 'error center' }, 'The guide could not be drawn.'), h('p', { className: 'muted small center' }, message));
    void app.sendLog({ level: 'error', data: `exercise guide draw failed: ${message}` }).catch(() => undefined);
  }
}

function applyHost(ctx: McpUiHostContext | undefined) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

app.ontoolresult = (result) => {
  const g = (result.structuredContent as { guide?: ExerciseGuide } | undefined)?.guide;
  if (g) {
    guide = g;
    render();
  } else if (result.isError) {
    root.replaceChildren(h('p', { className: 'error center' }, 'The guide could not be opened. Claude will explain why.'));
  }
};
app.onhostcontextchanged = (ctx) => {
  applyHost(ctx);
  motion?.setTheme();
  render();
};

await app.connect();
applyHost(app.getHostContext());
render();
