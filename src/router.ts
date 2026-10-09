import { signal } from '@preact/signals';
import { isDay, type Day } from './domain/dates';

export const ROUTES = ['today', 'history', 'progress', 'settings'] as const;
export type RouteName = (typeof ROUTES)[number];
/** Reachable by URL only, never in the tab bar (the living style guide). */
const HIDDEN = ['design'] as const;
export type AnyRoute = RouteName | (typeof HIDDEN)[number];

interface Parsed {
  name: AnyRoute;
  day?: Day;
}

function parse(hash: string): Parsed | null {
  const m = /^#\/([a-z]+)(?:\/(\d{4}-\d{2}-\d{2}))?$/.exec(hash);
  const name = m?.[1] as AnyRoute | undefined;
  if (!m || !name || !(ROUTES as readonly string[]).includes(name) && !(HIDDEN as readonly string[]).includes(name)) return null;
  return { name, day: m[2] && isDay(m[2]) ? m[2] : undefined };
}

const initial = parse(location.hash);
export const route = signal<AnyRoute>(initial?.name ?? 'today');
/** Day selected in the URL (`#/today/2026-10-08`); undefined means "today". */
export const routeDay = signal<Day | undefined>(initial?.day);

// Ignore non-route hashes (e.g. skip links) so they never change the screen.
window.addEventListener('hashchange', () => {
  const next = parse(location.hash);
  if (next) {
    route.value = next.name;
    routeDay.value = next.day;
  }
});
