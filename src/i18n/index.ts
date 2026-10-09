// English only in v1; every user-visible string goes through t() so this can grow later.
const en = {
  'app.name': 'Fitwell',
  'a11y.skip': 'Skip to content',
  'a11y.nav': 'Main',
  'nav.today': 'Today',
  'nav.history': 'History',
  'nav.progress': 'Progress',
  'nav.settings': 'Settings',
  'today.empty': 'Nothing logged yet. Whatever you add today will show up here.',
  'history.empty': 'Past days will appear here as you log them.',
  'progress.empty': 'Charts will appear once there is a little data to show.',
  'settings.theme': 'Appearance',
  'settings.theme.system': 'Match my device',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.privacy': 'Everything you log stays on this device. Fitwell has no accounts and sends nothing anywhere.',
  'storage.unavailable': "Saving isn't available in this browser mode, so changes won't be kept after you close the app.",
  'update.available': 'A new version is ready.',
  'update.apply': 'Update',
  'update.later': 'Later',
} as const;

export type Key = keyof typeof en;

export function t(key: Key): string {
  return en[key];
}
