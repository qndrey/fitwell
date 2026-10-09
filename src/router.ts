import { signal } from '@preact/signals';

export const ROUTES = ['today', 'history', 'progress', 'settings'] as const;
export type RouteName = (typeof ROUTES)[number];

function parse(hash: string): RouteName | null {
  const m = /^#\/([a-z]+)/.exec(hash);
  const name = m?.[1] as RouteName | undefined;
  return name && ROUTES.includes(name) ? name : null;
}

export const route = signal<RouteName>(parse(location.hash) ?? 'today');

// Ignore non-route hashes (e.g. skip links) so they never change the screen.
window.addEventListener('hashchange', () => {
  const next = parse(location.hash);
  if (next) route.value = next;
});
