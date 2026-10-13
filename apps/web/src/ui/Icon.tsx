import { Activity, ArrowLeft, CalendarDays, CalendarSearch, ChartLine, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Clock, Copy, Dumbbell, Ellipsis, Flag, Link2, Play, Repeat, Square, Download, Info, Minus, Plus, ScanBarcode, Search, Settings, Star, Timer, Trash, Upload, Utensils, X } from 'lucide-preact';

/** Lucide (ISC) icons, imported by name so only these ship. Decorative: meaning always comes from adjacent text or an aria-label. */
const ICONS = {
  today: CalendarDays,
  history: Clock,
  progress: ChartLine,
  settings: Settings,
  prev: ChevronLeft,
  next: ChevronRight,
  plus: Plus,
  minus: Minus,
  star: Star,
  download: Download,
  upload: Upload,
  trash: Trash,
  check: Check,
  close: X,
  info: Info,
  expand: ChevronDown,
  link: Link2,
  play: Play,
  stop: Square,
  search: Search,
  scan: ScanBarcode,
  food: Utensils,
  strength: Dumbbell,
  cardio: Activity,
  copy: Copy,
  back: ArrowLeft,
  more: Ellipsis,
  timer: Timer,
  finish: Flag,
  alert: CircleAlert,
  pickDay: CalendarSearch,
  repeat: Repeat,
} as const;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export function Icon({ name, filled, size = 'md' }: { name: IconName; filled?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const C = ICONS[name];
  return <C class={`icon icon-${size}`} aria-hidden="true" focusable="false" fill={filled ? 'currentColor' : 'none'} />;
}
