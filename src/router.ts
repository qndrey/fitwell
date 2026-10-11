import { signal } from '@preact/signals';
import { isDay, type Day } from './domain/dates';

export const ROUTES = ['today', 'history', 'progress', 'settings'] as const;
export type RouteName = (typeof ROUTES)[number];
/** Reachable by URL only, never in the tab bar. */
const HIDDEN = ['design', 'review', 'workout', 'about', 'ai', 'start'] as const;
export type AnyRoute = RouteName | (typeof HIDDEN)[number];

interface Parsed {
  name: AnyRoute;
  /** `#/today/2026-10-08`, `#/start/2026-10-08` */
  day?: Day;
  /** `#/workout/<id>` */
  id?: string;
}

function parse(hash: string): Parsed | null {
  const m = /^#\/([a-z]+)(?:\/([\w-]+))?$/.exec(hash);
  const name = m?.[1] as AnyRoute | undefined;
  if (!m || !name) return null;
  if (!(ROUTES as readonly string[]).includes(name) && !(HIDDEN as readonly string[]).includes(name)) return null;
  const seg = m[2];
  if (name === 'workout') return seg ? { name, id: seg } : null;
  return { name, day: seg && isDay(seg) ? seg : undefined };
}

const initial = parse(location.hash);
export const route = signal<AnyRoute>(initial?.name ?? 'today');
/** Day selected in the URL; undefined means "today". */
export const routeDay = signal<Day | undefined>(initial?.day);
export const routeId = signal<string | undefined>(initial?.id);

// Ignore non-route hashes (e.g. skip links) so they never change the screen.
window.addEventListener('hashchange', () => {
  const next = parse(location.hash);
  if (next) {
    route.value = next.name;
    routeDay.value = next.day;
    routeId.value = next.id;
  }
});
