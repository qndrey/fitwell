import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import type { MuscleMap } from '../../src/analytics/muscleTypes';
import type { ExerciseGuide } from '../../src/exercises/guide';
import { h } from '../shared/dom';
import { renderGuide } from '../shared/guide';
import { createMotionPlayer, isDarkTheme } from '../shared/motionView';
import { heatColours, renderMuscleMap } from '../shared/muscleMap';

const root = document.getElementById('app')!;
const app = new App({ name: 'Fitwell exercise guide', version: '0.1.0' }, {}, { autoResize: true });
let guide: ExerciseGuide | null = null;
/** This view also draws the muscle map (show_muscle_map), on the same body. */
let map: MuscleMap | null = null;
let mapShown: MuscleMap | null = null;
let loading = false;
let error = '';
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

async function changeWeeks(weeks: number) {
  if (!map) return;
  loading = true;
  error = '';
  render();
  try {
    const res = await app.callServerTool({ name: 'get_muscle_map', arguments: { weeks, to: map.to } });
    const next = (res.structuredContent as { muscleMap?: MuscleMap } | undefined)?.muscleMap;
    if (res.isError || !next) throw new Error('no data');
    map = next;
  } catch {
    error = 'Could not load that period. Try again.';
  }
  loading = false;
  render();
}

function render() {
  try {
    if (map) {
      const dark = isDarkTheme();
      if (map !== mapShown) {
        motion?.showHeat(heatColours(map, dark), 'A body with each muscle group coloured by how much it was trained');
        mapShown = map;
      }
      root.replaceChildren(h('section', { className: 'card single' }, renderMuscleMap(map, dark, motion?.element ?? null, (w) => void changeWeeks(w), loading)), error ? h('p', { className: 'error small center' }, error) : '');
      return;
    }
    if (guide && guide !== shown) {
      motion?.show(guide.motion, guide.name, { primary: guide.primary, secondary: guide.secondary });
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
  const m = (result.structuredContent as { muscleMap?: MuscleMap } | undefined)?.muscleMap;
  if (m) {
    map = m;
    render();
  } else if (g) {
    guide = g;
    render();
  } else if (result.isError) {
    root.replaceChildren(h('p', { className: 'error center' }, 'The guide could not be opened. Claude will explain why.'));
  }
};
app.onhostcontextchanged = (ctx) => {
  applyHost(ctx);
  motion?.setTheme();
  mapShown = null; // the heat colours follow the theme too
  render();
};

await app.connect();
applyHost(app.getHostContext());
render();
