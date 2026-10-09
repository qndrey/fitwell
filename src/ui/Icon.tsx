import { CalendarDays, ChartLine, Check, ChevronLeft, ChevronRight, Clock, Download, Info, Plus, ScanBarcode, Search, Settings, Star, Trash, Upload, X } from 'lucide-preact';

/** Lucide (ISC) icons, imported by name so only these ship. Decorative: meaning always comes from adjacent text or an aria-label. */
const ICONS = {
  today: CalendarDays,
  history: Clock,
  progress: ChartLine,
  settings: Settings,
  prev: ChevronLeft,
  next: ChevronRight,
  plus: Plus,
  star: Star,
  download: Download,
  upload: Upload,
  trash: Trash,
  check: Check,
  close: X,
  info: Info,
  search: Search,
  scan: ScanBarcode,
} as const;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export function Icon({ name, filled, size = 'md' }: { name: IconName; filled?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const C = ICONS[name];
  return <C class={`icon icon-${size}`} aria-hidden="true" focusable="false" fill={filled ? 'currentColor' : 'none'} />;
}
